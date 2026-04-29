/**
 * Moves Gmail-style `from:`, `to:`, … tokens out of `pattern` and into structured
 * search_index fields so small models aren't punished for prose in the regex slot.
 */

const SKIP_OP = new Set(['http', 'https', 'mailto', 'ftp'])

/** `word:value` where value is `"..."`, `'...'`, or `\S+` until next whitespace. */
const INLINE_OP =
  /\b(from|to|subject|after|before|category):(?:("([^"]*)")|('([^']*)')|([^\s]+))/gi

export type SearchIndexRawParams = {
  pattern?: string
  query?: string
  caseSensitive?: boolean
  from?: string
  to?: string
  after?: string
  before?: string
  subject?: string
  category?: string
  source?: string
}

/** Notes explain what changed (prepended into ripmail JSON `hints` on the agent path). */
export function coerceSearchIndexInlineOperators(raw: SearchIndexRawParams): {
  merged: SearchIndexRawParams
  notes: string[]
} {
  const text = ((raw.pattern ?? raw.query ?? '') as string).trim()
  if (!text || !/[a-z]{2,}:/i.test(text)) {
    return { merged: { ...raw }, notes: [] }
  }

  const notes: string[] = []
  let remainder = text
  const extracted: Partial<SearchIndexRawParams> = {}

  /** `from:user@corp.com|some regex tail` → structured `from` + remainder pattern */
  const fromPipeTail = /^from\s*:\s*([\w.%+~-]+@[^\s|]+)\s*\|\s*(.+)$/i.exec(text.trim())
  const didPipeTail = Boolean(
    fromPipeTail?.[1]?.trim() &&
      fromPipeTail?.[2]?.trim() &&
      !(raw.from ?? '').trim(),
  )
  if (didPipeTail && fromPipeTail) {
    extracted.from = fromPipeTail[1]!.trim()
    remainder = fromPipeTail[2]!.trim()
    notes.push(
      'Separated `from:email|…` into `from` + regex `pattern` — use structured `from` and `pattern` separately next time.',
    )
  }

  let didStripColonTokens = false
  for (const match of remainder.matchAll(INLINE_OP)) {
    const name = (match[1] ?? '').toLowerCase()
    if (SKIP_OP.has(name)) continue

    const v =
      (typeof match[3] === 'string' && match[3].length > 0
        ? match[3]
        : typeof match[5] === 'string' && match[5].length > 0
          ? match[5]
          : typeof match[6] === 'string'
            ? match[6]
            : '').trim()

    if (!name || !v) continue

    remainder = remainder.replace(match[0], ' ')
    didStripColonTokens = true

    const hasFrom = Boolean((raw.from ?? extracted.from ?? '').trim())

    switch (name) {
      case 'from':
        if (!hasFrom) extracted.from = v
        break
      case 'to':
        if (!(raw.to ?? '').trim()) extracted.to = v
        break
      case 'subject':
        if (!(raw.subject ?? '').trim()) extracted.subject = v
        break
      case 'after':
        if (!(raw.after ?? '').trim()) extracted.after = v
        break
      case 'before':
        if (!(raw.before ?? '').trim()) extracted.before = v
        break
      case 'category':
        if (!(raw.category ?? '').trim()) extracted.category = v
        break
      default:
        break
    }
  }

  remainder = remainder.replace(/\s+/g, ' ').trim()

  const structured = Boolean(
    extracted.from ||
      extracted.to ||
      extracted.subject ||
      extracted.after ||
      extracted.before ||
      extracted.category,
  )

  if (!didPipeTail && !structured && !didStripColonTokens) {
    return { merged: { ...raw }, notes: [] }
  }

  if (didStripColonTokens) {
    notes.push(
      'Interpreted Gmail-style tokens in `pattern` (`from:` / …) as structured filters instead of regex — use structured fields (`from`, …) next time.',
    )
  }

  return {
    merged: {
      ...raw,
      ...extracted,
      pattern: remainder || undefined,
      query: undefined,
    },
    notes,
  }
}

/** True if `--from` looks like a person's name (not an email or domain token). */
export function looksLikePersonNameOnly(fromMaybe: string | undefined): boolean {
  const t = fromMaybe?.trim() ?? ''
  if (!t || t.includes('@')) return false
  const parts = t.split(/\s+/).filter(Boolean)
  return parts.length >= 2 && parts.every((p) => /^[\p{L}][\p{L}'.-]*$/u.test(p))
}

/** Prepend Brain-side notes into ripmail JSON `hints` when stdout is JSON. */
export function mergeSearchIndexStdoutHints(stdout: string, prepend: string[]): string {
  const head = prepend.map((s) => s.trim()).filter(Boolean)
  if (head.length === 0) return stdout
  const t = stdout.trim()
  if (!t.startsWith('{')) return `${head.join('\n')}\n\n${stdout}`
  try {
    const j = JSON.parse(t) as Record<string, unknown>
    const hintArr = Array.isArray(j.hints)
      ? (j.hints as unknown[]).filter((x): x is string => typeof x === 'string')
      : []
    j.hints = [...head, ...hintArr]
    return `${JSON.stringify(j, null, 2)}\n`
  } catch {
    return `${head.join('\n')}\n\n${stdout}`
  }
}

const CURRENT_STATE_RECENCY_HINT =
  'Search results can mix old and current information. For current-state facts, read the newest relevant messages first; if older messages conflict with newer ones, treat older messages as historical context.'

/** Add lightweight date-range metadata and a recency hint for broad searches. */
export function addSearchIndexRecencyHints(stdout: string, params: SearchIndexRawParams): string {
  if (params.after?.trim() || params.before?.trim()) return stdout

  const t = stdout.trim()
  if (!t.startsWith('{')) return stdout

  try {
    const j = JSON.parse(t) as Record<string, unknown>
    const results = Array.isArray(j.results) ? j.results : []
    const dated = results
      .map((r) => {
        if (!r || typeof r !== 'object') return null
        const raw = (r as Record<string, unknown>).date
        if (typeof raw !== 'string' || !raw.trim()) return null
        const ms = Date.parse(raw)
        if (Number.isNaN(ms)) return null
        return { raw, ms }
      })
      .filter((r): r is { raw: string; ms: number } => r !== null)

    if (dated.length < 2) return stdout

    dated.sort((a, b) => b.ms - a.ms)
    const newest = dated[0]!
    const oldest = dated[dated.length - 1]!
    const spanDays = Math.floor((newest.ms - oldest.ms) / 86_400_000)
    if (spanDays < 30) return stdout

    j.dateRange = {
      newest: newest.raw,
      oldest: oldest.raw,
      spanDays,
    }

    const hintArr = Array.isArray(j.hints)
      ? (j.hints as unknown[]).filter((x): x is string => typeof x === 'string')
      : []
    if (!hintArr.some((h) => h === CURRENT_STATE_RECENCY_HINT)) {
      j.hints = [CURRENT_STATE_RECENCY_HINT, ...hintArr]
    }
    return `${JSON.stringify(j, null, 2)}\n`
  } catch {
    return stdout
  }
}
