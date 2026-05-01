import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'

/** Shell-escaped `ripmail search … --json` command line for tests and tooling. */
export function buildRipmailSearchCommandLine(params: {
  /** Regex pattern; omit when using only structured filters. */
  query?: string
  pattern?: string
  caseSensitive?: boolean
  from?: string
  to?: string
  after?: string
  before?: string
  subject?: string
  category?: string
  source?: string
  /** Max results to return. Omit to use ripmail's default (50). */
  limit?: number
}): string {
  const rm = ripmailBin()
  const q = (params.pattern ?? params.query ?? '').trim()
  const j = (s: string) => JSON.stringify(s)
  const parts: string[] = [rm, 'search']
  if (q.length > 0) {
    parts.push(j(q))
  }
  if (params.from?.trim()) {
    parts.push('--from', j(params.from.trim()))
  }
  if (params.to?.trim()) {
    parts.push('--to', j(params.to.trim()))
  }
  if (params.after?.trim()) {
    parts.push('--after', j(params.after.trim()))
  }
  if (params.before?.trim()) {
    parts.push('--before', j(params.before.trim()))
  }
  if (params.subject?.trim()) {
    parts.push('--subject', j(params.subject.trim()))
  }
  if (params.category?.trim()) {
    parts.push('--category', j(params.category.trim()))
  }
  if (params.caseSensitive) {
    parts.push('--case-sensitive')
  }
  if (params.limit != null && params.limit > 0) {
    parts.push('--limit', String(params.limit))
  }
  parts.push('--json')
  if (params.source?.trim()) {
    parts.push('--source', j(params.source.trim()))
  }
  return parts.join(' ')
}

/**
 * Resolution tier for search and inbox results. Higher result counts use lower-resolution
 * fields to reduce token consumption, with a hint guiding the agent to tighten filters.
 */
export type EmailResolutionTier = 'full' | 'compact' | 'minimal'

/**
 * Selects a resolution tier based on how many search results are being returned.
 *   full    (≤5 results):  all key fields including snippet
 *   compact (6-15 results): snippet omitted
 *   minimal (>15 results):  snippet and fromName omitted
 */
export function selectSearchResultTier(resultCount: number): EmailResolutionTier {
  if (resultCount <= 5) return 'full'
  if (resultCount <= 15) return 'compact'
  return 'minimal'
}

/** Fields kept per tier for search results. */
const SEARCH_TIER_KEYS: Record<EmailResolutionTier, readonly string[]> = {
  full: ['messageId', 'fromAddress', 'fromName', 'subject', 'date', 'snippet', 'sourceKind'],
  compact: ['messageId', 'fromAddress', 'fromName', 'subject', 'date', 'sourceKind'],
  minimal: ['messageId', 'fromAddress', 'subject', 'date', 'sourceKind'],
}

/**
 * Dynamically reduces search result payload based on result count:
 * - ≤5 results  → full (messageId, fromAddress, fromName, subject, date, snippet, sourceKind)
 * - 6–15 results → compact (same minus snippet)
 * - >15 results  → minimal (same minus snippet and fromName)
 *
 * Strips bodyPreview, threadId, sourceId, rank unconditionally. Keeps **sourceKind** (mail vs Drive/local file sources).
 * Passes through unchanged if stdout is not valid JSON or has no results.
 */
export function stripSearchIndexResult(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as {
      results?: Record<string, unknown>[]
      totalMatched?: number
      hints?: string[]
    }
    if (!Array.isArray(parsed.results) || parsed.results.length === 0) return stdout
    const tier = selectSearchResultTier(parsed.results.length)
    const keys = SEARCH_TIER_KEYS[tier]
    parsed.results = parsed.results.map((row) => {
      const out: Record<string, unknown> = {}
      for (const k of keys) {
        if (row[k] !== undefined) out[k] = row[k]
      }
      return out
    })
    return JSON.stringify(parsed)
  } catch {
    return stdout
  }
}

/**
 * Selects a resolution tier for inbox items based on total item count across all mailboxes.
 *   full    (≤8 items):  all fields
 *   compact (9–20 items): snippet omitted
 *   minimal (>20 items):  snippet and fromName omitted
 */
export function selectInboxTier(totalItems: number): EmailResolutionTier {
  if (totalItems <= 8) return 'full'
  if (totalItems <= 20) return 'compact'
  return 'minimal'
}

/** Fields kept per tier for inbox items (beyond the identity/date fields, decision fields are always kept). */
const INBOX_TIER_KEEP_KEYS: Record<EmailResolutionTier, readonly string[]> = {
  full: [
    'messageId', 'date', 'fromAddress', 'fromName', 'subject', 'snippet',
    'note', 'category', 'attachments', 'action',
    'matchedRuleIds', 'decisionSource', 'requiresUserAction', 'actionSummary',
  ],
  compact: [
    'messageId', 'date', 'fromAddress', 'fromName', 'subject',
    'note', 'category', 'action',
    'matchedRuleIds', 'decisionSource', 'requiresUserAction', 'actionSummary',
  ],
  minimal: [
    'messageId', 'date', 'fromAddress', 'subject', 'action',
    'matchedRuleIds', 'decisionSource', 'requiresUserAction', 'actionSummary',
  ],
}

/**
 * Applies dynamic resolution to `ripmail inbox` JSON output.
 * Counts items across all mailboxes and strips per-item fields based on tier:
 *   full    (≤8):  all fields retained
 *   compact (9–20): snippet stripped
 *   minimal (>20):  snippet and fromName stripped
 *
 * Returns the resolution metadata so callers can append agent-facing hints.
 * Passes through unchanged if stdout is not valid JSON or has no mailboxes array.
 */
export function applyInboxResolution(stdout: string): {
  text: string
  tier: EmailResolutionTier
  totalItems: number
} {
  const passthrough = { text: stdout, tier: 'full' as EmailResolutionTier, totalItems: 0 }
  try {
    const parsed = JSON.parse(stdout) as {
      mailboxes?: Array<{ items?: Record<string, unknown>[] } & Record<string, unknown>>
    } & Record<string, unknown>
    if (!Array.isArray(parsed.mailboxes)) return passthrough

    let totalItems = 0
    for (const mb of parsed.mailboxes) {
      if (Array.isArray(mb.items)) totalItems += mb.items.length
    }
    if (totalItems === 0) return { text: stdout, tier: 'full', totalItems: 0 }

    const tier = selectInboxTier(totalItems)
    if (tier === 'full') return { text: stdout, tier, totalItems }

    const keys = INBOX_TIER_KEEP_KEYS[tier]
    for (const mb of parsed.mailboxes) {
      if (Array.isArray(mb.items)) {
        mb.items = mb.items.map((item) => {
          const out: Record<string, unknown> = {}
          for (const k of keys) {
            if (item[k] !== undefined) out[k] = item[k]
          }
          return out
        })
      }
    }
    return { text: JSON.stringify(parsed), tier, totalItems }
  } catch {
    return passthrough
  }
}

/**
 * Strips agent-irrelevant fields from a `ripmail read --json` result.
 * `bodyHtml` is already absent by default (requires `--include-html`, which only the
 * UI route passes). The remaining stripped fields are also not useful to the agent:
 *   headersText   — raw RFC 2822 header block; structured fields cover what matters
 *   references    — full In-Reply-To chain of Message-IDs; can be 500–1000 chars
 *   threadId      — implementation id; rarely needed beyond messageId
 *   sourceId      — mailbox implementation detail
 *   sourceKind    — mailbox implementation detail
 *
 * Also truncates `body` to `bodyMaxChars` (default 5000) with a hint when over limit.
 * Passes through unchanged when stdout is not valid JSON.
 */
export function stripReadEmailResult(
  stdout: string,
  bodyMaxChars = 5000,
): string {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    delete parsed.headersText
    delete parsed.references
    delete parsed.threadId
    delete parsed.sourceId
    delete parsed.sourceKind
    const body = parsed.body
    if (typeof body === 'string' && body.length > bodyMaxChars) {
      parsed.body =
        body.slice(0, bodyMaxChars) +
        `\n...[body truncated at ${bodyMaxChars} chars; ${body.length} chars total — use read_attachment for any attachment text]`
    }
    return JSON.stringify(parsed)
  } catch {
    return stdout
  }
}

/** Build `ripmail …` argv after the binary name (e.g. `rules list`). Used by inbox_rules and tests. */
export function buildInboxRulesCommand(params: {
  op: 'list' | 'validate' | 'show' | 'add' | 'edit' | 'remove' | 'move' | 'feedback'
  /** Per-account rules overlay (email or source id) */
  source?: string
  sample?: boolean
  rule_id?: string
  rule_action?: 'ignore' | 'notify' | 'inform'
  /**
   * Subject+body regex/FTS pattern only. Do not put `from:`, `subject:`, or `category:` tokens here—ripmail rejects them.
   * Use `from` / `subject` / `category` parameters instead (same as `ripmail search` flags).
   */
  query?: string
  /** Structured From filter (`ripmail rules add --from` / search --from). */
  from?: string
  /** Structured To filter. */
  to?: string
  /** Structured Subject filter. */
  subject?: string
  /** Category label (sync metadata), e.g. promotional. */
  category?: string
  /**
   * When both `from` and `to` are set on add, pass true so the rule matches if either address applies.
   */
  from_or_to_union?: boolean
  insert_before?: string
  description?: string
  preview_window?: string
  /**
   * add: omit or true = classify the whole email thread when any message matches (ripmail default).
   * add: false = `--message-only` (match individual messages only).
   * edit: set true/false to run `--whole-thread` / `--message-only`; omit to leave `threadScope` unchanged.
   */
  apply_to_thread?: boolean
  before_rule_id?: string
  after_rule_id?: string
  feedback_text?: string
}): string {
  const mb = params.source?.trim()
    ? ` --source ${JSON.stringify(params.source.trim())}`
    : ''
  switch (params.op) {
    case 'list':
      return `rules list${mb}`
    case 'validate':
      return `rules validate${params.sample ? ' --sample' : ''}${mb}`
    case 'show': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=show')
      return `rules show ${JSON.stringify(params.rule_id.trim())}${mb}`
    }
    case 'add': {
      if (!params.rule_action) {
        throw new Error('rule_action is required for op=add')
      }
      const q = params.query?.trim() ?? ''
      const hasStructured = !!(
        params.from?.trim() ||
        params.to?.trim() ||
        params.subject?.trim() ||
        params.category?.trim()
      )
      if (!q && !hasStructured) {
        throw new Error('op=add requires query and/or at least one of: from, to, subject, category')
      }
      const j = JSON.stringify
      let tail = `rules add --action ${params.rule_action}`
      if (q) tail += ` --query ${j(q)}`
      if (params.from?.trim()) tail += ` --from ${j(params.from.trim())}`
      if (params.to?.trim()) tail += ` --to ${j(params.to.trim())}`
      if (params.subject?.trim()) tail += ` --subject ${j(params.subject.trim())}`
      if (params.category?.trim()) tail += ` --category ${j(params.category.trim())}`
      if (params.from_or_to_union === true) tail += ' --from-or-to-union'
      if (params.insert_before?.trim()) {
        tail += ` --insert-before ${j(params.insert_before.trim())}`
      }
      if (params.description?.trim()) {
        tail += ` --description ${j(params.description.trim())}`
      }
      if (params.preview_window?.trim()) {
        tail += ` --preview-window ${j(params.preview_window.trim())}`
      }
      if (params.apply_to_thread === false) {
        tail += ' --message-only'
      }
      return tail + mb
    }
    case 'edit': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=edit')
      const has =
        params.rule_action != null ||
        params.query != null ||
        params.preview_window != null ||
        params.apply_to_thread !== undefined ||
        params.from !== undefined ||
        params.to !== undefined ||
        params.subject !== undefined ||
        params.category !== undefined ||
        params.from_or_to_union !== undefined
      if (!has) {
        throw new Error(
          'op=edit requires at least one of: rule_action, query, from, to, subject, category, from_or_to_union, preview_window, apply_to_thread',
        )
      }
      const j = JSON.stringify
      let tail = `rules edit ${j(params.rule_id.trim())}`
      if (params.rule_action != null) tail += ` --action ${params.rule_action}`
      if (params.query != null) tail += ` --query ${j(params.query)}`
      if (params.from !== undefined) tail += ` --from ${j(params.from)}`
      if (params.to !== undefined) tail += ` --to ${j(params.to)}`
      if (params.subject !== undefined) tail += ` --subject ${j(params.subject)}`
      if (params.category !== undefined) tail += ` --category ${j(params.category)}`
      if (params.from_or_to_union !== undefined) {
        tail += ` --from-or-to-union ${params.from_or_to_union ? 'true' : 'false'}`
      }
      if (params.preview_window?.trim()) {
        tail += ` --preview-window ${j(params.preview_window.trim())}`
      }
      if (params.apply_to_thread === true) {
        tail += ' --whole-thread'
      } else if (params.apply_to_thread === false) {
        tail += ' --message-only'
      }
      return tail + mb
    }
    case 'remove': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=remove')
      return `rules remove ${JSON.stringify(params.rule_id.trim())}${mb}`
    }
    case 'move': {
      if (!params.rule_id?.trim()) throw new Error('rule_id is required for op=move')
      const b = params.before_rule_id?.trim()
      const a = params.after_rule_id?.trim()
      if ((b && a) || (!b && !a)) {
        throw new Error('op=move requires exactly one of: before_rule_id, after_rule_id')
      }
      const rel = b ? `--before ${JSON.stringify(b)}` : `--after ${JSON.stringify(a!)}`
      return `rules move ${JSON.stringify(params.rule_id.trim())} ${rel}${mb}`
    }
    case 'feedback': {
      if (!params.feedback_text?.trim()) throw new Error('feedback_text is required for op=feedback')
      return `rules feedback ${JSON.stringify(params.feedback_text.trim())}${mb}`
    }
    default: {
      const x: never = params.op
      throw new Error(`Unhandled op: ${String(x)}`)
    }
  }
}

/** Build CLI flags for ripmail draft edit from metadata params. */
export function buildDraftEditFlags(params: {
  subject?: string
  to?: string[]
  cc?: string[]
  bcc?: string[]
  add_to?: string[]
  add_cc?: string[]
  add_bcc?: string[]
  remove_to?: string[]
  remove_cc?: string[]
  remove_bcc?: string[]
}): string {
  const parts: string[] = []
  const flag = (name: string, values?: string[]) => {
    if (values?.length) for (const v of values) parts.push(`${name} ${JSON.stringify(v)}`)
  }
  if (params.subject) parts.push(`--subject ${JSON.stringify(params.subject)}`)
  flag('--to', params.to)
  flag('--cc', params.cc)
  flag('--bcc', params.bcc)
  flag('--add-to', params.add_to)
  flag('--add-cc', params.add_cc)
  flag('--add-bcc', params.add_bcc)
  flag('--remove-to', params.remove_to)
  flag('--remove-cc', params.remove_cc)
  flag('--remove-bcc', params.remove_bcc)
  return parts.length ? parts.join(' ') + ' ' : ''
}

/** Build `ripmail sources add --kind googleDrive …` argv tail after the binary name. */
export function buildSourcesAddGoogleDriveCommand(params: {
  email: string
  oauthSourceId: string
  label?: string
  id?: string
  folderIds?: string[]
  includeSharedWithMe?: boolean
  maxFileBytes?: number
}): string {
  const parts = [
    'sources add --kind googleDrive',
    `--email ${JSON.stringify(params.email)}`,
    `--oauth-source-id ${JSON.stringify(params.oauthSourceId)}`,
  ]
  if (params.label?.trim()) parts.push(`--label ${JSON.stringify(params.label.trim())}`)
  if (params.id?.trim()) parts.push(`--id ${JSON.stringify(params.id.trim())}`)
  for (const fid of params.folderIds ?? []) {
    const t = fid.trim()
    if (t) parts.push(`--root-id ${JSON.stringify(t)}`)
  }
  if (params.includeSharedWithMe) parts.push('--include-shared-with-me')
  if (params.maxFileBytes != null && params.maxFileBytes > 0) {
    parts.push(`--max-file-bytes ${params.maxFileBytes}`)
  }
  parts.push('--json')
  return parts.join(' ')
}

/** Build `ripmail sources add --kind localDir …` argv tail after the binary name. Used by add_files_source and tests. */
export function buildSourcesAddLocalDirCommand(params: {
  rootIds: string[]
  label?: string
  id?: string
}): string {
  const roots = params.rootIds.map((r) => r.trim()).filter(Boolean)
  if (!roots.length) throw new Error('buildSourcesAddLocalDirCommand: rootIds required')
  const parts = ['sources add --kind localDir']
  for (const r of roots) {
    parts.push(`--root-id ${JSON.stringify(r)}`)
  }
  if (params.label?.trim()) parts.push(`--label ${JSON.stringify(params.label.trim())}`)
  if (params.id?.trim()) parts.push(`--id ${JSON.stringify(params.id.trim())}`)
  parts.push('--json')
  return parts.join(' ')
}

/** Build `ripmail sources edit …` argv tail after the binary name. */
export function buildSourcesEditCommand(params: { id: string; label?: string; path?: string }): string {
  const parts = [`sources edit ${JSON.stringify(params.id)}`]
  if (params.label?.trim()) parts.push(`--label ${JSON.stringify(params.label.trim())}`)
  if (params.path?.trim()) parts.push(`--path ${JSON.stringify(params.path.trim())}`)
  parts.push('--json')
  return parts.join(' ')
}

/** Build `ripmail sources remove …` argv tail after the binary name. */
export function buildSourcesRemoveCommand(id: string): string {
  return `sources remove ${JSON.stringify(id)} --json`
}

/** Build `ripmail refresh` argv tail: bare refresh or scoped `--source`. */
export function buildReindexCommand(params: { sourceId?: string }): string {
  if (params.sourceId?.trim()) {
    return `refresh --source ${JSON.stringify(params.sourceId.trim())}`
  }
  return 'refresh'
}
