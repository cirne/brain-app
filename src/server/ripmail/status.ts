/**
 * status() — index health summary.
 * Mirrors ripmail/src/status.rs.
 */

import type { RipmailDb } from './db.js'
import { loadRipmailConfig, getImapSources } from './sync/config.js'
import { gmailOAuthHistoricalBackfillPending } from './sync/persist.js'
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

function sqliteStartedAtToAgeMs(syncLockStartedAt: unknown): number | null {
  if (typeof syncLockStartedAt !== 'string' || syncLockStartedAt.trim() === '') return null
  const s = syncLockStartedAt.trim()
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const age = Date.now() - t
  return age >= 0 ? age : null
}

/**
 * Build a ParsedRipmailStatus from the in-process DB — compatible with parseRipmailStatusJson consumers.
 */
export function statusParsed(db: RipmailDb, ripmailHome: string): ParsedRipmailStatus {
  const msgCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as Record<string, number>
  )['n'] ?? 0

  const row1 = db.prepare(`SELECT * FROM sync_summary WHERE id = 1`).get() as Record<string, unknown> | undefined
  const row2 = db.prepare(`SELECT * FROM sync_summary WHERE id = 2`).get() as Record<string, unknown> | undefined

  const refreshRunning = (row1?.is_running ?? 0) === 1
  const backfillRunning = (row2?.is_running ?? 0) === 1
  const syncRunning = refreshRunning || backfillRunning

  const ages: number[] = []
  const a1 = sqliteStartedAtToAgeMs(row1?.sync_lock_started_at)
  const a2 = sqliteStartedAtToAgeMs(row2?.sync_lock_started_at)
  if (refreshRunning && a1 != null) ages.push(a1)
  if (backfillRunning && a2 != null) ages.push(a2)
  const syncLockAgeMs = ages.length === 0 ? null : ages.some((a) => a < 0) ? Math.min(...ages) : Math.max(...ages)

  const lastSyncAt =
    row1?.last_sync_at != null ? String(row1.last_sync_at) : row2?.last_sync_at != null ? String(row2.last_sync_at) : null
  const earliestDate = row1?.earliest_synced_date != null ? String(row1.earliest_synced_date) : null
  const latestDate = row1?.latest_synced_date != null ? String(row1.latest_synced_date) : null

  const stale = false
  const config = loadRipmailConfig(ripmailHome)
  const gmailOAuthIds = getImapSources(config)
    .filter((s) => s.imapAuth === 'googleOAuth')
    .map((s) => s.id)
  let gmailHistoricalPending = false
  for (const id of gmailOAuthIds) {
    if (gmailOAuthHistoricalBackfillPending(db, id)) {
      gmailHistoricalPending = true
      break
    }
  }
  const deepHistoricalPending = gmailHistoricalPending && !syncRunning && !stale
  /** Gate (small-inbox advance): block only before first indexed Gmail slice lands. */
  const pendingRefresh = deepHistoricalPending && msgCount === 0

  const backfillListedTarget =
    backfillRunning &&
    row2 != null &&
    typeof row2.total_messages === 'number' &&
    row2.total_messages > 0
      ? row2.total_messages
      : null

  return {
    indexedTotal: msgCount,
    lastSyncedAt: lastSyncAt,
    dateRange: { from: earliestDate, to: latestDate },
    syncRunning,
    refreshRunning,
    backfillRunning,
    syncLockAgeMs,
    ftsReady: msgCount,
    staleLockInDb: stale,
    initialSyncHangSuspected: false,
    pendingRefresh,
    deepHistoricalPending,
    backfillListedTarget,
    messageAvailableForProgress: msgCount > 0 ? msgCount : null,
  }
}

export function status(db: RipmailDb): StatusResult {
  const msgCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as Record<string, number>
  )['n'] ?? 0

  const summaryRow = db.prepare(`SELECT * FROM sync_summary WHERE id = 1`).get() as SyncSummaryRow | undefined

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

  const refreshLane = (summaryRow?.is_running ?? 0) === 1
  const row2 = db.prepare(`SELECT is_running FROM sync_summary WHERE id = 2`).get() as { is_running: number } | undefined
  const backfillLane = (row2?.is_running ?? 0) === 1

  return {
    indexedMessages: msgCount,
    sources,
    isRunning: refreshLane || backfillLane,
    earliestSyncedDate: summaryRow?.earliest_synced_date ?? undefined,
    latestSyncedDate: summaryRow?.latest_synced_date ?? undefined,
    lastSyncAt: summaryRow?.last_sync_at ?? undefined,
  }
}
