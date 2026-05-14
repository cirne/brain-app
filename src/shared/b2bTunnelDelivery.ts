/**
 * Outbound tunnel placeholder while the answering side has not yet released the draft
 * (OPP-111 review-before-send). Prefer `b2bDelivery: 'awaiting_peer_review'` on the assistant
 * row — UI renders localized copy via i18n; avoid persisting user-visible English here.
 */

/** @deprecated Recognize old sessions that stored this as assistant text before i18n. */
export const B2B_OUTBOUND_AWAITING_PEER_REVIEW_TEXT_DEPRECATED = 'Sent · pending approval'

const AWAITING_PEER_REVIEW_LEGACY_ASSISTANT_TEXT = [
  B2B_OUTBOUND_AWAITING_PEER_REVIEW_TEXT_DEPRECATED,
  "Received · they'll approve the reply before it sends",
] as const

export type B2bAwaitingPeerReviewAssistantProbe = {
  role?: string
  b2bDelivery?: 'awaiting_peer_review'
  content?: string
  parts?: Array<{ type: string; content?: string }>
}

export function assistantPlainTextForB2bProbe(m: B2bAwaitingPeerReviewAssistantProbe): string {
  const parts = m.parts?.find(
    (p): p is { type: 'text'; content: string } => p.type === 'text' && typeof p.content === 'string',
  )
  if (parts?.content) return parts.content
  return typeof m.content === 'string' ? m.content : ''
}

/** True when this assistant row is the outbound “waiting on collaborator approval” placeholder. */
export function isB2bAwaitingPeerReviewAssistantMessage(m: B2bAwaitingPeerReviewAssistantProbe): boolean {
  if (m.b2bDelivery === 'awaiting_peer_review') return true
  if (m.role != null && m.role !== 'assistant') return false
  const text = assistantPlainTextForB2bProbe(m).trim()
  return (AWAITING_PEER_REVIEW_LEGACY_ASSISTANT_TEXT as readonly string[]).includes(text)
}

export function isLastAssistantMessageAwaitingPeerReview(
  messages: B2bAwaitingPeerReviewAssistantProbe[],
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'assistant') continue
    return isB2bAwaitingPeerReviewAssistantMessage(m)
  }
  return false
}

/** Substring matched against persisted session preview — sidebar awaiting indicator without loading full transcript. */
export const B2B_TUNNEL_AWAITING_PEER_PREVIEW_SNIPPET = 'approve the reply'

/**
 * Inbound cold-query assistant placeholder while {@link promptB2BAgentForText} runs asynchronously.
 * Replaced by the real draft (or an error message) in the background job.
 */
export const B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT = 'Drafting a suggested reply…'
