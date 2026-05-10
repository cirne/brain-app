/**
 * status() — index health summary.
 * Mirrors ripmail/src/status.rs.
 */

import type { RipmailDb } from './db.js'
import type { StatusResult, SourceStatus } from './types.js'

interface SyncSummaryRow {
  earliest_synced_date: string | null
  latest_synced_date: string | null
  last_sync_at: string | null
  is_running: number
}

interface SourceRow {
  id: string
  kind: string
  label: string | null
  last_synced_at: string | null
  doc_count: number
}

export function status(db: RipmailDb): StatusResult {
  const msgCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as Record<string, number>
  )['n'] ?? 0

  const summaryRow = db.prepare(`SELECT * FROM sync_summary LIMIT 1`).get() as SyncSummaryRow | undefined

  const sourceRows = db
    .prepare(
      `SELECT id, kind, label, last_synced_at, doc_count FROM sources ORDER BY id`,
    )
    .all() as SourceRow[]

  const sources: SourceStatus[] = sourceRows.map((r) => ({
    sourceId: r.id,
    kind: r.kind,
    label: r.label ?? undefined,
    lastSyncedAt: r.last_synced_at ?? undefined,
    docCount: r.doc_count,
  }))

  return {
    indexedMessages: msgCount,
    sources,
    isRunning: (summaryRow?.is_running ?? 0) === 1,
    earliestSyncedDate: summaryRow?.earliest_synced_date ?? undefined,
    latestSyncedDate: summaryRow?.latest_synced_date ?? undefined,
    lastSyncAt: summaryRow?.last_sync_at ?? undefined,
  }
}
