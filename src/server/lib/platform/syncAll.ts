import process from 'node:process'
import { formatExecError } from './execError.js'
import { ripmailHomeForBrain, ripmailProcessEnv } from './brainHome.js'
import { getHubRipmailSourcesList } from '@server/lib/hub/hubRipmailSources.js'
import { ensureGoogleOAuthImapSiblingSources } from './googleOAuth.js'
import { RIPMAIL_REFRESH_TIMEOUT_MS } from '@server/lib/ripmail/ripmailTimeouts.js'
import { refresh as ripmailRefresh } from '@server/ripmail/sync/index.js'
import { syncMailNotifyNotificationsFromRipmailDbSafe } from '@server/lib/notifications/syncMailNotifyNotifications.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export { ripmailProcessEnv as ripmailRefreshEnv, RIPMAIL_REFRESH_TIMEOUT_MS }

export interface SyncComponentResult {
  ok: boolean
  error?: string
}

export interface FullSyncResult {
  wiki: SyncComponentResult
  inbox: SyncComponentResult
}

export interface SyncInboxRipmailBoundedOptions {
  sourceId?: string
  timeoutMs: number
  signal?: AbortSignal
}

export type SyncInboxRipmailBoundedResult =
  | { kind: 'completed'; ok: true }
  | { kind: 'completed'; ok: false; error: string }
  | { kind: 'timeout' }
  | { kind: 'aborted' }

/**
 * Wiki content is plain files on disk (no git backup or remote sync).
 * Kept as a no-op so full sync and POST /api/wiki/sync still succeed.
 */
export async function syncWikiFromDisk(): Promise<SyncComponentResult> {
  return { ok: true }
}

/**
 * Run **`refresh`** in-process for the current brain home — always awaited (no detached spawn).
 */
/** `ripmail sources list --json` kinds that map to calendar sync only (no IMAP mail). */
const CALENDAR_SOURCE_KINDS = new Set([
  'googleCalendar',
  'appleCalendar',
  'icsSubscription',
  'icsFile',
])

/**
 * Run **`refresh`** for each configured calendar source — does not sync IMAP or other
 * source types. No-op when there are no calendar sources.
 */
export async function syncCalendarSourcesRipmail(_signal?: AbortSignal): Promise<SyncComponentResult> {
  try {
    await ensureGoogleOAuthImapSiblingSources(ripmailHomeForBrain())
  } catch (e) {
    brainLogger.warn({ err: formatExecError(e), context: 'calendar-only-refresh' }, 'sync:ripmail:ensure-oauth-failed')
  }
  const { sources, error } = await getHubRipmailSourcesList()
  if (error) {
    return { ok: false, error }
  }
  const calIds = sources.filter((s) => CALENDAR_SOURCE_KINDS.has(s.kind)).map((s) => s.id)
  if (calIds.length === 0) {
    return { ok: true }
  }
  for (const id of calIds) {
    try {
      await ripmailRefresh(ripmailHomeForBrain(), { sourceId: id })
      await syncMailNotifyNotificationsFromRipmailDbSafe()
    } catch (e) {
      const detail = formatExecError(e)
      brainLogger.warn({ sourceId: id, err: detail }, 'sync:ripmail:calendar-source-failed')
      return { ok: false, error: detail }
    }
  }
  return { ok: true }
}

export async function syncInboxRipmail(_signal?: AbortSignal): Promise<SyncComponentResult> {
  try {
    await ensureGoogleOAuthImapSiblingSources(ripmailHomeForBrain())
  } catch (e) {
    brainLogger.warn({ err: formatExecError(e), context: 'inbox-sync-all' }, 'sync:ripmail:ensure-oauth-failed')
  }
  try {
    await ripmailRefresh(ripmailHomeForBrain())
    await syncMailNotifyNotificationsFromRipmailDbSafe()
    return { ok: true }
  } catch (e) {
    const detail = formatExecError(e)
    brainLogger.warn({ err: detail }, 'sync:ripmail:inbox-refresh-failed')
    return { ok: false, error: detail }
  }
}

function logDetachedRipmailRefreshError(sourceId: string | undefined, e: unknown): void {
  const detail = formatExecError(e)
  brainLogger.warn(
    { sourceId: sourceId ?? null, err: detail },
    'sync:ripmail:bounded-detached-failed',
  )
}

async function runRipmailRefreshWork(sourceId?: string): Promise<void> {
  try {
    await ensureGoogleOAuthImapSiblingSources(ripmailHomeForBrain())
  } catch (e) {
    brainLogger.warn({ err: formatExecError(e), context: 'bounded-refresh' }, 'sync:ripmail:ensure-oauth-failed')
  }
  const sid = sourceId?.trim() || undefined
  await ripmailRefresh(ripmailHomeForBrain(), sid ? { sourceId: sid } : undefined)
  await syncMailNotifyNotificationsFromRipmailDbSafe()
}

/**
 * Start an in-process ripmail refresh and wait for at most `timeoutMs`.
 * Timeout/abort only stops waiting; the refresh promise is left running and logged on failure.
 */
export async function syncInboxRipmailBounded(
  opts: SyncInboxRipmailBoundedOptions,
): Promise<SyncInboxRipmailBoundedResult> {
  const sourceId = opts.sourceId?.trim() || undefined
  const work = runRipmailRefreshWork(sourceId)

  if (opts.timeoutMs <= 0) {
    void work.catch((e) => logDetachedRipmailRefreshError(sourceId, e))
    return { kind: 'timeout' }
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  let cleanupAbort: (() => void) | undefined
  const completed = work.then(
    (): SyncInboxRipmailBoundedResult => ({ kind: 'completed', ok: true }),
    (e: unknown): SyncInboxRipmailBoundedResult => ({ kind: 'completed', ok: false, error: formatExecError(e) }),
  )

  const contenders: Promise<SyncInboxRipmailBoundedResult>[] = [
    completed,
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve({ kind: 'timeout' }), opts.timeoutMs)
    }),
  ]

  if (opts.signal) {
    if (opts.signal.aborted) {
      contenders.push(Promise.resolve({ kind: 'aborted' }))
    } else {
      contenders.push(
        new Promise((resolve) => {
          const onAbort = () => resolve({ kind: 'aborted' } satisfies SyncInboxRipmailBoundedResult)
          opts.signal!.addEventListener('abort', onAbort, { once: true })
          cleanupAbort = () => opts.signal!.removeEventListener('abort', onAbort)
        }),
      )
    }
  }

  const result = await Promise.race(contenders)
  if (timeout) clearTimeout(timeout)
  cleanupAbort?.()
  if (result.kind === 'timeout' || result.kind === 'aborted') {
    void work.catch((e) => logDetachedRipmailRefreshError(sourceId, e))
  }
  return result
}

/** First onboarding pass: single ~1y Gmail historical slice (TS `refresh` + `historicalSince`). Interview can start once count gates pass while this run continues in the background. */
export async function syncInboxRipmailOnboarding(_signal?: AbortSignal): Promise<SyncComponentResult> {
  try {
    await ensureGoogleOAuthImapSiblingSources(ripmailHomeForBrain())
  } catch (e) {
    brainLogger.warn({ err: formatExecError(e), context: 'onboarding-sync' }, 'sync:ripmail:ensure-oauth-failed')
  }
  try {
    await ripmailRefresh(ripmailHomeForBrain(), { historicalSince: '1y' })
    await syncMailNotifyNotificationsFromRipmailDbSafe()
    return { ok: true }
  } catch (e) {
    const detail = formatExecError(e)
    brainLogger.warn({ err: detail, lane: 'onboarding-backfill' }, 'sync:ripmail:onboarding-failed')
    return { ok: false, error: detail }
  }
}

/**
 * Wiki + ripmail refresh (includes indexed calendar). Does not throw — callers log per-component results.
 */
export async function runFullSync(inboxSignal?: AbortSignal): Promise<FullSyncResult> {
  const [wiki, inbox] = await Promise.all([syncWikiFromDisk(), syncInboxRipmail(inboxSignal)])
  return { wiki, inbox }
}

/**
 * Run **`refresh`** and wait up to `timeoutMs`. Timeout only stops waiting;
 * the in-process refresh continues in the background.
 */
export async function refreshMailAndWait(
  timeoutMs = RIPMAIL_REFRESH_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<{ ok: boolean; timedOut?: boolean; error?: string }> {
  const result = await syncInboxRipmailBounded({ timeoutMs, signal })
  switch (result.kind) {
    case 'completed':
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    case 'timeout':
      return { ok: false, timedOut: true }
    case 'aborted':
      return { ok: false, error: 'aborted' }
  }
}

const DEFAULT_SYNC_INTERVAL_SECONDS = 300

/** Interval for periodic `runFullSync` (server). Invalid/missing env falls back to 300 seconds. */
export function getSyncIntervalMs(): number {
  const raw = process.env.SYNC_INTERVAL_SECONDS
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_SYNC_INTERVAL_SECONDS * 1000
  const n = parseInt(String(raw).trim(), 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SYNC_INTERVAL_SECONDS * 1000
  return n * 1000
}
