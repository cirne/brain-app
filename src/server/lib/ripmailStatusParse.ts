/**
 * Pure parse of `ripmail status --json` stdout for onboarding / diagnostics.
 */

export type ParsedRipmailStatus = {
  indexedTotal: number | null
  lastSyncedAt: string | null
  dateRange: { from: string | null; to: string | null }
  syncRunning: boolean
  ftsReady: number | null
}

function readNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function readStrOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  return null
}

/** Sum `messageCount` across `mailboxes[]` (Apple Mail interim progress updates here while `sync.totalMessages` stays 0). */
function sumMailboxMessageCounts(mailboxes: unknown): number {
  if (!Array.isArray(mailboxes)) return 0
  let n = 0
  for (const row of mailboxes) {
    if (!row || typeof row !== 'object') continue
    const c = readNum((row as Record<string, unknown>).messageCount)
    if (c != null) n += c
  }
  return n
}

/**
 * Best-effort indexed count: `sync.totalMessages` once the sync layer has committed totals;
 * while Apple Mail backfill runs, ripmail often keeps `totalMessages` at 0 but updates
 * `mailboxes[].messageCount` and `search.ftsReady` — use those as interim counts.
 */
function resolveIndexedTotal(
  sync: Record<string, unknown>,
  mailboxes: unknown,
  fts: number | null,
): number | null {
  const totalFromSync = readNum(sync.totalMessages)
  if (totalFromSync != null && totalFromSync > 0) return totalFromSync

  const mailboxSum = sumMailboxMessageCounts(mailboxes)
  const interim = Math.max(fts ?? 0, mailboxSum)
  if (interim > 0) return interim
  if (totalFromSync === 0) return 0
  return null
}

/** Parse stdout from `ripmail status --json`. Returns null if JSON is invalid or missing `sync`. */
export function parseRipmailStatusJson(stdout: string): ParsedRipmailStatus | null {
  try {
    const j = JSON.parse(stdout) as Record<string, unknown>
    const sync = j.sync as Record<string, unknown> | undefined
    if (!sync || typeof sync !== 'object') return null

    const search = j.search as Record<string, unknown> | undefined
    const fts = search && typeof search === 'object' ? readNum(search.ftsReady) : null

    return {
      indexedTotal: resolveIndexedTotal(sync, j.mailboxes, fts),
      lastSyncedAt: readStrOrNull(sync.lastSyncAt),
      dateRange: {
        from: readStrOrNull(sync.earliestSyncedDate),
        to: readStrOrNull(sync.latestSyncedDate),
      },
      syncRunning: sync.isRunning === true,
      ftsReady: fts,
    }
  } catch {
    return null
  }
}
