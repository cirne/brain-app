/**
 * Lightweight email address checks for drafts (not full RFC 5322 validation).
 */

const PLAIN_ADDR_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ANGLE_ADDR_RE = /<([^<>\s@]+@[^<>\s@][^<>\s]*)>\s*$/

/** Extracts the addr-spec from `Name <user@host>` or returns trimmed input. */
export function extractEmailAddress(raw: string): string {
  const t = raw.trim()
  const angle = ANGLE_ADDR_RE.exec(t)
  if (angle) return angle[1]!.trim().toLowerCase()
  return t.toLowerCase()
}

/** True when the string looks like a deliverable email (plain or angle-addr). */
export function looksLikeEmailAddress(raw: string): boolean {
  const t = raw.trim()
  if (!t) return false
  const addr = extractEmailAddress(t)
  return PLAIN_ADDR_RE.test(addr)
}
