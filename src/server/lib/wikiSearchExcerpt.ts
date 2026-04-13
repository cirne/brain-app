/**
 * Build a short plain-text excerpt for unified search, centered on the query
 * when possible (similar spirit to email snippets).
 */
export function stripYamlFrontMatter(raw: string): string {
  if (!raw.startsWith('---')) return raw
  const rest = raw.slice(3)
  const end = rest.indexOf('\n---')
  if (end < 0) return raw
  return rest.slice(end + 4).trimStart()
}

/** Reduce markdown-ish noise for matching and display. */
export function toSearchPlainText(raw: string): string {
  let s = stripYamlFrontMatter(raw)
  s = s.replace(/^#{1,6}\s+[^\n]*\n?/gm, '')
  s = s.replace(/```[\s\S]*?```/g, ' ')
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  s = s.replace(/[*_`>#|]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

const DEFAULT_RADIUS = 72
const MAX_LEN = 200

export function buildWikiExcerpt(raw: string, query: string): string {
  const q = query.trim()
  const plain = toSearchPlainText(raw)
  if (!plain) return ''

  if (!q) {
    const t = plain.length > MAX_LEN ? plain.slice(0, MAX_LEN).trimEnd() + '…' : plain
    return t
  }

  const lower = plain.toLowerCase()
  const qLower = q.toLowerCase()
  let idx = lower.indexOf(qLower)

  if (idx < 0) {
    const parts = qLower.split(/\s+/).filter(Boolean)
    for (const part of parts) {
      if (part.length < 2) continue
      idx = lower.indexOf(part)
      if (idx >= 0) break
    }
  }

  if (idx < 0) {
    const t = plain.length > MAX_LEN ? plain.slice(0, MAX_LEN).trimEnd() + '…' : plain
    return t
  }

  const start = Math.max(0, idx - DEFAULT_RADIUS)
  const end = Math.min(plain.length, idx + q.length + DEFAULT_RADIUS)
  let slice = plain.slice(start, end).trim()
  if (start > 0) slice = '…' + slice
  if (end < plain.length) slice = slice + '…'

  if (slice.length > MAX_LEN) {
    slice = slice.slice(0, MAX_LEN - 1).trimEnd() + '…'
  }
  return slice
}
