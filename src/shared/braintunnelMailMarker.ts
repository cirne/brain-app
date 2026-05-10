/** Authoritative cross-workspace mail marker (subject line). See OPP-106. */
export const BRAINTUNNEL_MAIL_SUBJECT_PREFIX = '[braintunnel]' as const

const RE_PREFIX = /^(Re|Fwd):\s*/i

/** Strip repeated Re:/Fwd: prefixes for marker detection. */
export function normalizeSubjectForBraintunnelDetection(raw: string): string {
  let s = raw.trim()
  for (;;) {
    const next = s.replace(RE_PREFIX, '').trim()
    if (next === s) break
    s = next
  }
  return s
}

export function isBraintunnelMailSubject(raw: string): boolean {
  return normalizeSubjectForBraintunnelDetection(raw).startsWith(BRAINTUNNEL_MAIL_SUBJECT_PREFIX)
}

/**
 * Subject for notification summary: keep Re:/Fwd: chain, remove one `[braintunnel] ` block after normalization.
 */
export function displaySubjectWithoutBraintunnelMarker(raw: string): string {
  const t = raw.trim()
  const reChain: string[] = []
  let rest = t
  for (;;) {
    const m = rest.match(RE_PREFIX)
    if (!m?.[0]) break
    reChain.push(m[0])
    rest = rest.slice(m[0].length).trim()
  }
  let body = rest
  if (body.startsWith(BRAINTUNNEL_MAIL_SUBJECT_PREFIX)) {
    body = body.slice(BRAINTUNNEL_MAIL_SUBJECT_PREFIX.length).trimStart()
  }
  return `${reChain.join('')}${body}`.trim()
}

/**
 * When `draft_email` is used with `b2b_query: true`, ensure the subject line carries the collaborator
 * marker **once** after any `Re:` / `Fwd:` chain. Caller supplies the substantive subject snippet; this
 * only prepends the `[braintunnel]` prefix and a single space before the substantive subject when missing.
 */
export function ensureBraintunnelCollaboratorSubject(raw: string): string {
  const t = raw.trim()
  if (!t) return BRAINTUNNEL_MAIL_SUBJECT_PREFIX
  const reChain: string[] = []
  let rest = t
  for (;;) {
    const m = rest.match(RE_PREFIX)
    if (!m?.[0]) break
    reChain.push(m[0])
    rest = rest.slice(m[0].length).trim()
  }
  const stem = normalizeSubjectForBraintunnelDetection(rest)
  if (stem.startsWith(BRAINTUNNEL_MAIL_SUBJECT_PREFIX)) return t

  const trimmedInner = rest.trim()
  const inner =
    trimmedInner.length === 0
      ? BRAINTUNNEL_MAIL_SUBJECT_PREFIX
      : `${BRAINTUNNEL_MAIL_SUBJECT_PREFIX} ${trimmedInner}`
  return `${reChain.join('')}${inner}`
}

/** Validates optional `grant_id` for `draft_email` (matches global brain_query_grants ids). */
export function assertOptionalBrainQueryGrantId(grantId: string | undefined): void {
  if (!grantId?.trim()) return
  const t = grantId.trim()
  if (!/^bqg_[0-9a-f]{24}$/.test(t)) {
    throw new Error('grant_id must look like bqg_ followed by 24 hex characters')
  }
}
