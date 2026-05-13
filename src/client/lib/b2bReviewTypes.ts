/** Row from `GET /api/chat/b2b/review` (UI-facing state uses `sent` instead of `approved`). */
export type B2BGrantPolicyApi = 'auto' | 'review' | 'ignore'

export type B2BReviewRowApi = {
  sessionId: string
  /** Set when inbound is linked to a brain-query grant; null for cold-query pre-handshake. */
  grantId: string | null
  /** True when this inbound was created via cold query (OPP-112). */
  isColdQuery?: boolean
  /** Grant policy when `grantId` is set; null for cold rows before handshake. */
  policy: B2BGrantPolicyApi | null
  peerHandle: string | null
  peerDisplayName: string | null
  askerSnippet: string
  draftSnippet: string
  state: string
  updatedAtMs: number
}
