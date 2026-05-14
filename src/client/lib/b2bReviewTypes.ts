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
  /** Preflight: false when peer message is FYI (cold handshake uses different primary action copy). */
  expectsResponse?: boolean
}

/** Parse `GET /api/chat/b2b/review` JSON body into review rows (shared by ReviewQueue + Tunnels list). */
export function parseB2BReviewListResponse(body: unknown): B2BReviewRowApi[] {
  const j = body as { items?: unknown }
  const list = Array.isArray(j.items) ? j.items : []
  const next: B2BReviewRowApi[] = []
  for (const x of list) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const sessionId = typeof o.sessionId === 'string' ? o.sessionId.trim() : ''
    if (!sessionId) continue
    const grantRaw = o.grantId
    const grantId =
      typeof grantRaw === 'string' && grantRaw.trim().length > 0 ? grantRaw.trim() : null
    const polRaw = o.policy
    const policy =
      polRaw === 'auto' || polRaw === 'review' || polRaw === 'ignore' ? polRaw : null
    const expectsRaw = o.expectsResponse
    const expectsResponse = expectsRaw === false ? false : true
    next.push({
      sessionId,
      grantId,
      isColdQuery: o.isColdQuery === true,
      policy,
      peerHandle: typeof o.peerHandle === 'string' ? o.peerHandle : null,
      peerDisplayName: typeof o.peerDisplayName === 'string' ? o.peerDisplayName : null,
      askerSnippet: typeof o.askerSnippet === 'string' ? o.askerSnippet : '',
      draftSnippet: typeof o.draftSnippet === 'string' ? o.draftSnippet : '',
      state: typeof o.state === 'string' ? o.state : 'pending',
      updatedAtMs: typeof o.updatedAtMs === 'number' ? o.updatedAtMs : 0,
      expectsResponse,
    })
  }
  return next
}
