/**
 * Pure parse of `ripmail status --json` stdout for onboarding / diagnostics.
 */

export type ParsedRipmailStatus = {
  indexedTotal: number | null
  lastSyncedAt: string | null
  dateRange: { from: string | null; to: string | null }
  /** True when a live sync holds the lock (not stale DB “running” with no process). */
  syncRunning: boolean
  /** Refresh lane only (`sync.refresh` or legacy flat `sync`). */
  refreshRunning: boolean
  /** Backfill lane only (`sync.backfill`); false when the JSON has no backfill lane. */
  backfillRunning: boolean
  /** Age of the sync lock in ms (`sync.refresh.lockAgeMs` / backfill); useful when message count is still zero. */
  syncLockAgeMs: number | null
  /** Same as indexed row count (`search.indexedMessages` / `ftsReady` in JSON). */
  ftsReady: number | null
  staleLockInDb: boolean
  initialSyncHangSuspected: boolean
  /** First-time mailbox: needs a refresh/backfill and nothing is actively syncing. */
  pendingRefresh: boolean
  /**
   * Onboarding “downloaded / available” denominator: sum of `mailboxes[].messageCount` when non-zero, else
   * `sync.refresh.totalMessages`, else `sync.backfill.totalMessages`. Null when no usable total yet.
   */
  messageAvailableForProgress: number | null
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

/** New ripmail: nested `sync.refresh`; legacy: flat fields on `sync`. */
function getRefreshLane(sync: Record<string, unknown>): Record<string, unknown> {
  const r = sync.refresh
  if (r && typeof r === 'object') return r as Record<string, unknown>
  return sync
}

function getBackfillLane(sync: Record<string, unknown>): Record<string, unknown> | null {
  const b = sync.backfill
  if (b && typeof b === 'object') return b as Record<string, unknown>
  return null
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
 * Rows in the local index (`messages` / FTS). Never use `sync.refresh.totalMessages` for this — it is sync bookkeeping and can diverge.
 */
function resolveIndexedTotal(
  sync: Record<string, unknown>,
  mailboxes: unknown,
  search: Record<string, unknown> | undefined,
): number | null {
  const refresh = getRefreshLane(sync)
  const indexed = readSearchIndexedCount(search)
  const totalFromSync = readNum(refresh.totalMessages)
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

export type ComputeIndexingUserHintOptions = {
  mailProvider?: 'apple' | 'google' | null
}

/**
 * Actionable hints only — shown on the indexing hero instead of noisy status churn.
 * Non-actionable reassurance is handled client-side after a quiet period.
 */
export function computeIndexingActionHint(parsed: ParsedRipmailStatus): string | null {
  if (parsed.staleLockInDb) {
    return 'A previous mail sync stopped unexpectedly.'
  }
  if (parsed.initialSyncHangSuspected) {
    return 'This is taking longer than usual. Very large mailboxes can stay at zero for several minutes while the first batch loads. If nothing changes after a long wait, refresh the page and try again.'
  }
  return null
}

/**
 * Plain-language status for the onboarding “indexing mail” screen (non-technical users).
 * Precedence: stuck DB → sync not started → active but zero count.
 * @deprecated Prefer {@link computeIndexingActionHint} for the onboarding hero; full hint kept for diagnostics/tests.
 */
export function computeIndexingUserHint(
  parsed: ParsedRipmailStatus,
  opts?: ComputeIndexingUserHintOptions,
): string | null {
  if (parsed.staleLockInDb) {
    return 'A previous mail sync stopped unexpectedly. Refresh the page to resume.'
  }
  if (parsed.initialSyncHangSuspected) {
    return 'This is taking longer than usual. Very large mailboxes can stay at zero for several minutes while the first batch loads. If nothing changes after a long wait, refresh the page and try again.'
  }
  if (parsed.pendingRefresh) {
    return 'Mail sync is starting — the count should begin moving soon. If it stays at zero, refresh the page and try again.'
  }
  if (
    parsed.syncRunning &&
    (parsed.indexedTotal ?? 0) === 0 &&
    (parsed.ftsReady ?? 0) === 0
  ) {
    if (opts?.mailProvider === 'google') {
      return 'The first connection may take a few minutes. It’s normal if your message count stays at zero until messages start to appear.'
    }
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

    const refresh = getRefreshLane(sync)
    const backfill = getBackfillLane(sync)

    const search = j.search as Record<string, unknown> | undefined
    const indexedCount = readSearchIndexedCount(search)

    const stale = readBool(sync.staleLockInDb) === true

    const refreshLive = readBool(refresh.lockHeldByLiveProcess) !== false
    const refreshRunning = refresh.isRunning === true && refreshLive && !stale

    const backfillLive =
      backfill != null ? readBool(backfill.lockHeldByLiveProcess) !== false : false
    const backfillRunning =
      backfill != null && backfill.isRunning === true && backfillLive && !stale

    const syncRunning = refreshRunning || backfillRunning

    const rAge = readNum(refresh.lockAgeMs)
    const bAge = backfill != null ? readNum(backfill.lockAgeMs) : null
    const lockAge =
      rAge != null || bAge != null ? Math.max(rAge ?? 0, bAge ?? 0) : null

    const hang = readBool(sync.initialSyncHangSuspected) === true
    const pendingRefresh = anyMailboxNeedsBackfill(j.mailboxes) && !syncRunning && !stale

    const lastSyncedAt =
      readStrOrNull(refresh.lastSyncAt) ?? (backfill != null ? readStrOrNull(backfill.lastSyncAt) : null)

    const mbSum = sumMailboxMessageCounts(j.mailboxes)
    const refreshTot = readNum(refresh.totalMessages)
    const backfillTot = backfill != null ? readNum((backfill as Record<string, unknown>).totalMessages) : null
    let messageAvailableForProgress: number | null = null
    if (mbSum > 0) {
      messageAvailableForProgress = mbSum
    } else if (refreshTot != null && refreshTot > 0) {
      messageAvailableForProgress = refreshTot
    } else if (backfillTot != null && backfillTot > 0) {
      messageAvailableForProgress = backfillTot
    }

    return {
      indexedTotal: resolveIndexedTotal(sync, j.mailboxes, search),
      lastSyncedAt,
      dateRange: {
        from: readStrOrNull(refresh.earliestSyncedDate),
        to: readStrOrNull(refresh.latestSyncedDate),
      },
      syncRunning,
      refreshRunning,
      backfillRunning,
      syncLockAgeMs: lockAge,
      ftsReady: indexedCount,
      staleLockInDb: stale,
      initialSyncHangSuspected: hang,
      pendingRefresh,
      messageAvailableForProgress,
    }
  } catch {
    return null
  }
}

/** Compact snapshot for `ripmail status` subprocess close logs (Node logs only; not sent to clients). */
export function buildRipmailStatusLogSnapshot(
  stdout: string,
):
  | { statusParse: 'failed' }
  | {
      statusParse: 'ok'
      syncRunning: boolean
      refreshRunning: boolean
      backfillRunning: boolean
      lockAgeMs: number | null
      indexed: number | null
      pendingBackfill: boolean
      staleLock: boolean
      hangSuspected: boolean
      lastSyncAt: string | null
      forProgress: number | null
    } {
  const p = parseRipmailStatusJson(stdout)
  if (!p) {
    return { statusParse: 'failed' as const }
  }
  return {
    statusParse: 'ok' as const,
    syncRunning: p.syncRunning,
    refreshRunning: p.refreshRunning,
    backfillRunning: p.backfillRunning,
    lockAgeMs: p.syncLockAgeMs,
    indexed: p.indexedTotal ?? p.ftsReady ?? null,
    pendingBackfill: p.pendingRefresh,
    staleLock: p.staleLockInDb,
    hangSuspected: p.initialSyncHangSuspected,
    lastSyncAt: p.lastSyncedAt,
    forProgress: p.messageAvailableForProgress,
  }
}
