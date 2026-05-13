/** Row from `GET /api/chat/b2b/review` (UI-facing state uses `sent` instead of `approved`). */
export type B2BReviewRowApi = {
  sessionId: string
  grantId: string
  peerHandle: string | null
  peerDisplayName: string | null
  askerSnippet: string
  draftSnippet: string
  state: string
  updatedAtMs: number
}
