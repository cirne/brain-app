/**
 * Persisted content for the outbound tunnel placeholder message while the answering side has not
 * yet released the draft (OPP-111 review-before-send). The UI detects this state via the
 * `b2bDelivery: 'awaiting_peer_review'` flag and renders a compact receipt row instead of
 * displaying this text verbatim.
 */
export const B2B_OUTBOUND_AWAITING_PEER_REVIEW_TEXT = 'Sent · pending approval'

/** Substring matched against persisted session preview — sidebar awaiting indicator without loading full transcript. */
export const B2B_TUNNEL_AWAITING_PEER_PREVIEW_SNIPPET = 'pending approval'

/**
 * Inbound cold-query assistant placeholder while {@link promptB2BAgentForText} runs asynchronously.
 * Replaced by the real draft (or an error message) in the background job.
 */
export const B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT = 'Drafting a suggested reply…'
