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

/** Instruction prefix for `draft_email` when `b2b_query` is true (ripmail LLM compose). */
export const BRAINTUNNEL_DRAFT_EMAIL_INSTRUCTION_PREFIX =
  `The email subject line must start with exactly \`${BRAINTUNNEL_MAIL_SUBJECT_PREFIX}\` followed by a single space, then the rest of the subject. Do not repeat that tag. Do not put the tag inside the body unless the user explicitly asks.\n\n`

/** Validates optional `grant_id` for `draft_email` (matches global brain_query_grants ids). */
export function assertOptionalBrainQueryGrantId(grantId: string | undefined): void {
  if (!grantId?.trim()) return
  const t = grantId.trim()
  if (!/^bqg_[0-9a-f]{24}$/.test(t)) {
    throw new Error('grant_id must look like bqg_ followed by 24 hex characters')
  }
}

export function buildB2bDraftEmailInstruction(userInstruction: string, grantId?: string): string {
  assertOptionalBrainQueryGrantId(grantId)
  let s = `${BRAINTUNNEL_DRAFT_EMAIL_INSTRUCTION_PREFIX}${userInstruction.trim()}`
  if (grantId?.trim()) {
    s += `\n\n(Assistant-only grant id — do not paste into the email body unless the user asks: ${grantId.trim()})`
  }
  return s
}
