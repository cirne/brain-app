/**
 * Pure parse of `ripmail status --json` stdout for onboarding / diagnostics.
 */

export type ParsedRipmailStatus = {
  indexedTotal: number | null
  lastSyncedAt: string | null
  dateRange: { from: string | null; to: string | null }
  /** True when a live sync holds the lock (not stale DB “running” with no process). */
  syncRunning: boolean
  /** Age of the sync lock in ms (`sync.lockAgeMs`); useful when message count is still zero. */
  syncLockAgeMs: number | null
  /** Same as indexed row count (`search.indexedMessages` / `ftsReady` in JSON). */
  ftsReady: number | null
  staleLockInDb: boolean
  initialSyncHangSuspected: boolean
  /** First-time mailbox: needs a refresh/backfill and nothing is actively syncing. */
  pendingRefresh: boolean
}

function readNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function readStrOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  return null
}

function readBool(v: unknown): boolean | undefined {
  if (v === true) return true
  if (v === false) return false
  return undefined
}

/** Sum `messageCount` across `mailboxes[]` (matches per-mailbox `COUNT(*)` in ripmail; interim hint when indexed is still 0). */
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

/** Ripmail `status --json`: `search.indexedMessages` (canonical); legacy builds only had `ftsReady` (same value). */
function readSearchIndexedCount(search: Record<string, unknown> | undefined): number | null {
  if (!search || typeof search !== 'object') return null
  const fromIndexed = readNum(search.indexedMessages)
  if (fromIndexed != null) return fromIndexed
  return readNum(search.ftsReady)
}

/**
 * Rows in the local index (`messages` / FTS). Never use `sync.totalMessages` for this — it is sync bookkeeping and can diverge.
 */
function resolveIndexedTotal(
  sync: Record<string, unknown>,
  mailboxes: unknown,
  search: Record<string, unknown> | undefined,
): number | null {
  const indexed = readSearchIndexedCount(search)
  const totalFromSync = readNum(sync.totalMessages)
  const mailboxSum = sumMailboxMessageCounts(mailboxes)

    if (indexed != null) {
    if (indexed > 0) return indexed
    if (mailboxSum > 0) return mailboxSum
    if (totalFromSync != null && totalFromSync > 0) return totalFromSync
    if (totalFromSync === 0) return 0
    return 0
  }

  if (totalFromSync != null && totalFromSync > 0) return totalFromSync
  if (mailboxSum > 0) return mailboxSum
  if (totalFromSync === 0) return 0
  return null
}

function anyMailboxNeedsBackfill(mailboxes: unknown): boolean {
  if (!Array.isArray(mailboxes)) return false
  for (const row of mailboxes) {
    if (!row || typeof row !== 'object') continue
    if ((row as Record<string, unknown>).needsBackfill === true) return true
  }
  return false
}

/**
 * Plain-language status for the onboarding “indexing mail” screen (non-technical users).
 * Precedence: stuck DB → suspected hang → sync not started → active but zero count.
 */
export function computeIndexingUserHint(parsed: ParsedRipmailStatus): string | null {
  if (parsed.staleLockInDb) {
    return 'A previous mail sync stopped unexpectedly. Quit Brain completely (Cmd+Q), open it again, and we’ll resume.'
  }
  if (parsed.initialSyncHangSuspected) {
    return 'This is taking longer than usual. Very large mailboxes can stay at zero for several minutes while the first batch loads. If nothing changes after a long wait, quit Brain and try again.'
  }
  if (parsed.pendingRefresh) {
    return 'Mail sync is starting — the count should begin moving soon. If it stays at zero, quit Brain and try again.'
  }
  if (
    parsed.syncRunning &&
    (parsed.indexedTotal ?? 0) === 0 &&
    (parsed.ftsReady ?? 0) === 0
  ) {
    // UI shows `sync.lockAgeMs` as live “sync running” feedback; keep a short note only when we lack that.
    if (parsed.syncLockAgeMs != null && parsed.syncLockAgeMs >= 1000) {
      return 'The count can stay at zero for a few minutes while Mail is scanned — that’s normal.'
    }
    return 'We’re scanning your mailbox. The number can stay at zero for a few minutes before the first messages appear — that’s normal.'
  }
  return null
}

/** Parse stdout from `ripmail status --json`. Returns null if JSON is invalid or missing `sync`. */
export function parseRipmailStatusJson(stdout: string): ParsedRipmailStatus | null {
  try {
    const j = JSON.parse(stdout) as Record<string, unknown>
    const sync = j.sync as Record<string, unknown> | undefined
    if (!sync || typeof sync !== 'object') return null

    const search = j.search as Record<string, unknown> | undefined
    const indexedCount = readSearchIndexedCount(search)

    const stale = readBool(sync.staleLockInDb) === true
    const lockLive = readBool(sync.lockHeldByLiveProcess) !== false
    const isRunning = sync.isRunning === true
    const syncRunning = isRunning && lockLive && !stale

    const hang = readBool(sync.initialSyncHangSuspected) === true
    const pendingRefresh = anyMailboxNeedsBackfill(j.mailboxes) && !syncRunning && !stale
    const lockAge = readNum(sync.lockAgeMs)

    return {
      indexedTotal: resolveIndexedTotal(sync, j.mailboxes, search),
      lastSyncedAt: readStrOrNull(sync.lastSyncAt),
      dateRange: {
        from: readStrOrNull(sync.earliestSyncedDate),
        to: readStrOrNull(sync.latestSyncedDate),
      },
      syncRunning,
      syncLockAgeMs: lockAge,
      ftsReady: indexedCount,
      staleLockInDb: stale,
      initialSyncHangSuspected: hang,
      pendingRefresh,
    }
  } catch {
    return null
  }
}
