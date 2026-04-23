import type { ToolCall } from '../agentUtils.js'
import type { ContentCardPreview } from '../cards/contentCardShared.js'

const SEARCH_DETAIL_MAX = 56

/** Compact line for mail index search: pattern/query, or structured filters when no text term. */
export function searchIndexDetail(args: Record<string, unknown>): string | undefined {
  const raw = [args.query, args.pattern].find((x) => typeof x === 'string' && String(x).trim()) as string | undefined
  if (raw?.trim()) {
    const t = raw.trim()
    return t.length > SEARCH_DETAIL_MAX ? `${t.slice(0, SEARCH_DETAIL_MAX - 1)}…` : t
  }
  const parts: string[] = []
  const push = (label: string, key: keyof typeof args) => {
    const v = typeof args[key] === 'string' ? String(args[key]).trim() : ''
    if (!v) return
    const short = v.length > 36 ? `${v.slice(0, 35)}…` : v
    parts.push(`${label} ${short}`)
  }
  push('from', 'from')
  push('to', 'to')
  push('subject', 'subject')
  push('after', 'after')
  push('before', 'before')
  push('category', 'category')
  if (typeof args.source === 'string' && args.source.trim()) {
    const s = args.source.trim()
    parts.push(`source ${s.length > 28 ? `${s.slice(0, 27)}…` : s}`)
  }
  if (!parts.length) return undefined
  const joined = parts.join(' · ')
  return joined.length > SEARCH_DETAIL_MAX ? `${joined.slice(0, SEARCH_DETAIL_MAX - 1)}…` : joined
}

export function webSearchDetail(args: Record<string, unknown>): string | undefined {
  const q = typeof args.query === 'string' ? args.query.trim() : ''
  if (!q) return undefined
  return q.length > 56 ? `${q.slice(0, 55)}…` : q
}

export function readEmailIdHint(rawId: string): string | undefined {
  const s = rawId.trim()
  if (!s) return undefined
  if (s.startsWith('file:') || s.startsWith('/') || /^[A-Za-z]:\\/.test(s)) {
    const seg = s.replace(/\\/g, '/')
    const base = seg.split('/').pop() ?? seg
    try {
      const decoded = decodeURIComponent(base)
      return decoded.length > 48 ? `${decoded.slice(0, 47)}…` : decoded
    } catch {
      return base.length > 48 ? `${base.slice(0, 47)}…` : base
    }
  }
  return s.length > 40 ? `${s.slice(0, 39)}…` : s
}

/** Subject/from for completed reads; short id/path hint while tool is in flight or preview unavailable. */
export function readEmailProgressDetail(
  tc: ToolCall,
  matchPreview: (t: ToolCall) => ContentCardPreview | null,
): string | undefined {
  if (tc.done && !tc.isError) {
    const prev = matchPreview(tc)
    if (prev?.kind === 'email') {
      const sub = prev.subject?.trim() || '(No subject)'
      const from = prev.from?.trim()
      const one = from ? `${sub} — ${from}` : sub
      return one.length > 88 ? `${one.slice(0, 87)}…` : one
    }
    if (prev?.kind === 'file') {
      const p = prev.path
      const seg = p.replace(/\\/g, '/')
      const base = seg.split('/').pop() ?? p
      try {
        const decoded = decodeURIComponent(base)
        return decoded.length > 48 ? `${decoded.slice(0, 47)}…` : decoded
      } catch {
        return base.length > 48 ? `${base.slice(0, 47)}…` : base
      }
    }
  }
  const id = typeof tc.args?.id === 'string' ? tc.args.id.trim() : ''
  return readEmailIdHint(id)
}
