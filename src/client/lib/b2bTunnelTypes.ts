/** `GET /api/chat/b2b/tunnels` row (subset for UI). Mirrors server `TunnelListRowApi`. */
export type B2BTunnelListRowApi = {
  peerUserId: string
  outboundGrantId: string | null
  inboundGrantId: string | null
  peerHandle: string
  peerDisplayName: string
  outboundSessionId: string | null
  grantId: string | null
  ownerDisplayName: string
  ownerHandle: string
  ownerId: string
  sessionId: string | null
  lastActivityMs: number
  snippet: string
  pendingReviewCount: number
  inboundPolicy: 'auto' | 'review' | 'ignore' | null
}

/** Parse `GET /api/chat/b2b/tunnels` JSON body into sidebar / Tunnels-list rows (shared by ChatHistory + Tunnels surface). */
export function parseB2BTunnelListResponse(body: unknown): B2BTunnelListRowApi[] {
  const j = body as { tunnels?: unknown }
  const list = Array.isArray(j.tunnels) ? j.tunnels : []
  const next: B2BTunnelListRowApi[] = []
  for (const x of list) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    next.push({
      peerUserId: typeof r.peerUserId === 'string' ? r.peerUserId : String(r.ownerId ?? ''),
      outboundGrantId: typeof r.outboundGrantId === 'string' ? r.outboundGrantId : null,
      inboundGrantId: typeof r.inboundGrantId === 'string' ? r.inboundGrantId : null,
      peerHandle:
        typeof r.peerHandle === 'string'
          ? r.peerHandle.trim()
          : typeof r.ownerHandle === 'string'
            ? String(r.ownerHandle).trim()
            : '',
      peerDisplayName:
        typeof r.peerDisplayName === 'string'
          ? r.peerDisplayName.trim()
          : typeof r.ownerDisplayName === 'string'
            ? String(r.ownerDisplayName).trim()
            : '',
      outboundSessionId:
        typeof r.outboundSessionId === 'string'
          ? r.outboundSessionId
          : typeof r.sessionId === 'string'
            ? r.sessionId
            : null,
      grantId: typeof r.grantId === 'string' ? r.grantId : null,
      ownerDisplayName:
        typeof r.ownerDisplayName === 'string' ? r.ownerDisplayName : String(r.peerDisplayName ?? ''),
      ownerHandle: typeof r.ownerHandle === 'string' ? r.ownerHandle : String(r.peerHandle ?? ''),
      ownerId: typeof r.ownerId === 'string' ? r.ownerId : String(r.peerUserId ?? ''),
      sessionId:
        typeof r.sessionId === 'string'
          ? r.sessionId
          : typeof r.outboundSessionId === 'string'
            ? r.outboundSessionId
            : null,
      lastActivityMs: typeof r.lastActivityMs === 'number' ? r.lastActivityMs : 0,
      snippet: typeof r.snippet === 'string' ? r.snippet : '',
      pendingReviewCount: typeof r.pendingReviewCount === 'number' ? r.pendingReviewCount : 0,
      inboundPolicy:
        r.inboundPolicy === 'auto' || r.inboundPolicy === 'review' || r.inboundPolicy === 'ignore'
          ? r.inboundPolicy
          : null,
    })
  }
  return next.filter((t) => t.peerHandle.trim().length > 0)
}
