/**
 * status() — index health summary.
 * Mirrors ripmail/src/status.rs.
 */

import type { RipmailDb } from './db.js'
import type { StatusResult, SourceStatus } from './types.js'
import type { ParsedRipmailStatus } from '@server/lib/ripmail/ripmailStatusParse.js'

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

/**
 * Build a ParsedRipmailStatus from the in-process DB — compatible with parseRipmailStatusJson consumers.
 * The TS sync layer does not track lock age or pending backfill; those are always false/null.
 */
export function statusParsed(db: RipmailDb): ParsedRipmailStatus {
  const msgCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as Record<string, number>
  )['n'] ?? 0

  const summaryRow = db.prepare(`SELECT * FROM sync_summary LIMIT 1`).get() as Record<string, unknown> | undefined
  const isRunning = (summaryRow?.is_running ?? 0) === 1
  const lastSyncAt = summaryRow?.last_sync_at != null ? String(summaryRow.last_sync_at) : null
  const earliestDate = summaryRow?.earliest_synced_date != null ? String(summaryRow.earliest_synced_date) : null
  const latestDate = summaryRow?.latest_synced_date != null ? String(summaryRow.latest_synced_date) : null

  return {
    indexedTotal: msgCount,
    lastSyncedAt: lastSyncAt,
    dateRange: { from: earliestDate, to: latestDate },
    syncRunning: isRunning,
    refreshRunning: isRunning,
    backfillRunning: false,
    syncLockAgeMs: null,
    ftsReady: msgCount,
    staleLockInDb: false,
    initialSyncHangSuspected: false,
    pendingRefresh: msgCount === 0 && !isRunning,
    messageAvailableForProgress: msgCount > 0 ? msgCount : null,
  }
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
