/** Debounced full sync after wiki file changes + single-flight (no overlapping runs) with coalesced follow-up. */

export const DEFAULT_WIKI_SYNC_DEBOUNCE_MS = 2000

let pending: ReturnType<typeof setTimeout> | undefined
let runSync: (() => void | Promise<void>) | undefined

let inFlight = false
let pendingFollowUp = false

export function registerDebouncedWikiSyncRunner(fn: () => void | Promise<void>): void {
  runSync = fn
}

/** Clears runner + debounce timer only (safe while sync is in flight). */
export function clearDebouncedWikiSyncRunner(): void {
  runSync = undefined
  cancelPendingDebouncedWikiSync()
}

/** Full reset for tests — do not call during a live sync in production. */
export function resetWikiSyncCoordinatorForTests(): void {
  runSync = undefined
  cancelPendingDebouncedWikiSync()
  inFlight = false
  pendingFollowUp = false
}

export function cancelPendingDebouncedWikiSync(): void {
  if (pending !== undefined) {
    clearTimeout(pending)
    pending = undefined
  }
}

/**
 * Wiki changed: debounce when idle, or coalesce to one follow-up sync if a run is already in flight.
 */
export function onWikiMutatedForAutoSync(ms = DEFAULT_WIKI_SYNC_DEBOUNCE_MS): void {
  cancelPendingDebouncedWikiSync()
  if (inFlight) {
    pendingFollowUp = true
  } else {
    scheduleDebouncedSyncAfterWikiChange(ms)
  }
}

/**
 * Run the registered sync now, or queue exactly one follow-up if already running.
 */
export async function runSyncOrQueueFollowUp(): Promise<void> {
  if (!runSync) return
  if (inFlight) {
    pendingFollowUp = true
    return
  }
  await executeSyncLoop()
}

async function executeSyncLoop(): Promise<void> {
  const run = runSync
  if (!run) return
  inFlight = true
  try {
    await run()
  } finally {
    inFlight = false
    if (pendingFollowUp) {
      pendingFollowUp = false
      await executeSyncLoop()
    }
  }
}

/**
 * After quiet time, start sync (or queue if another sync is already running).
 */
export function scheduleDebouncedSyncAfterWikiChange(ms = DEFAULT_WIKI_SYNC_DEBOUNCE_MS): void {
  cancelPendingDebouncedWikiSync()
  pending = setTimeout(() => {
    pending = undefined
    void runSyncOrQueueFollowUp()
  }, ms)
}

/** @internal Vitest / debugging */
export function __syncCoordinatorStateForTests(): {
  inFlight: boolean
  pendingFollowUp: boolean
  hasDebouncedTimer: boolean
} {
  return {
    inFlight,
    pendingFollowUp,
    hasDebouncedTimer: pending !== undefined,
  }
}
