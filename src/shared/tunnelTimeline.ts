/** Server + client tunnel activity timeline (`GET /api/chat/b2b/tunnel-timeline/:handle`). */

export type TunnelTimelineActorSide = 'yours' | 'theirs'

export type TunnelTimelineActorKind = 'you' | 'your_brain' | 'them' | 'their_brain'

export type TunnelTimelineMessageApi = {
  kind: 'message'
  /** Stable synthetic id across reloads (`out-${sid}-${seq}`, `in-${sid}-${seq}`, …). */
  id: string
  atMs: number
  side: TunnelTimelineActorSide
  actor: TunnelTimelineActorKind
  body: string
  /** When true, {@link body} may be empty — show `chat.b2b.awaitingReceiptLabel` in the client. */
  b2bAwaitingPeerReview?: boolean
  hint?: 'auto_sent' | 'to_their_brain'
}

export type TunnelTimelinePendingReviewApi = {
  kind: 'pending_review'
  id: string
  atMs: number
  sessionId: string
  grantId: string | null
  isColdQuery: boolean
  policy: 'auto' | 'review' | 'ignore' | null
  peerHandle: string | null
  peerDisplayName: string | null
  askerSnippet: string
  draftSnippet: string
  /** UI-sent state label (pending | sent aliases). */
  state: string
  updatedAtMs: number
}

export type TunnelTimelineEntryApi = TunnelTimelineMessageApi | TunnelTimelinePendingReviewApi
