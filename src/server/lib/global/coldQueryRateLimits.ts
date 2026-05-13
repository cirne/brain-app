import { getBrainGlobalDb } from '@server/lib/global/brainGlobalDb.js'

/** One cold query per sender→receiver pair per rolling window (early product default). */
export const COLD_QUERY_RATE_LIMIT_MS = 24 * 60 * 60 * 1000

export function assertColdQueryRateAllowed(params: {
  senderHandle: string
  receiverHandle: string
  nowMs?: number
}): { ok: true } | { ok: false; retryAfterMs: number } {
  const db = getBrainGlobalDb()
  const sh = params.senderHandle.trim().toLowerCase().replace(/^@/, '')
  const rh = params.receiverHandle.trim().toLowerCase().replace(/^@/, '')
  if (!sh || !rh) return { ok: true }
  const now = params.nowMs ?? Date.now()
  const row = db
    .prepare(
      `SELECT sent_at_ms FROM cold_query_rate_limits WHERE sender_handle = ? AND receiver_handle = ?`,
    )
    .get(sh, rh) as { sent_at_ms: number } | undefined
  if (row != null && now - row.sent_at_ms < COLD_QUERY_RATE_LIMIT_MS) {
    return { ok: false, retryAfterMs: COLD_QUERY_RATE_LIMIT_MS - (now - row.sent_at_ms) }
  }
  return { ok: true }
}

export function recordColdQuerySent(params: {
  senderHandle: string
  receiverHandle: string
  nowMs?: number
}): void {
  const db = getBrainGlobalDb()
  const sh = params.senderHandle.trim().toLowerCase().replace(/^@/, '')
  const rh = params.receiverHandle.trim().toLowerCase().replace(/^@/, '')
  const now = params.nowMs ?? Date.now()
  db.prepare(
    `INSERT INTO cold_query_rate_limits (sender_handle, receiver_handle, sent_at_ms) VALUES (?, ?, ?)
     ON CONFLICT(sender_handle, receiver_handle) DO UPDATE SET sent_at_ms = excluded.sent_at_ms`,
  ).run(sh, rh, now)
}
