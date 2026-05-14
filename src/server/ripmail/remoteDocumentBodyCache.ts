/**
 * Single TTL for authoritative remote-document reads (Drive today; Notion-style later).
 * Tune here only — do not duplicate literals per connector.
 */
export const REMOTE_DOCUMENT_BODY_CACHE_TTL_MS = 3_600_000 // 1 hour
