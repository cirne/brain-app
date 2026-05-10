import process from 'node:process'
import { formatExecError } from './execError.js'
import { ripmailHomeForBrain } from './brainHome.js'
import { getHubRipmailSourcesList } from '@server/lib/hub/hubRipmailSources.js'
import { ensureGoogleOAuthImapSiblingSources } from './googleOAuth.js'
import {
  RipmailTimeoutError,
  RIPMAIL_REFRESH_TIMEOUT_MS,
  ripmailProcessEnv,
} from '@server/lib/ripmail/ripmailRun.js'
import { refresh as ripmailRefresh } from '@server/ripmail/sync/index.js'
import { syncMailNotifyNotificationsFromRipmailDbSafe } from '@server/lib/notifications/syncMailNotifyNotifications.js'

export { ripmailProcessEnv as ripmailRefreshEnv, RIPMAIL_REFRESH_TIMEOUT_MS }

export interface SyncComponentResult {
  ok: boolean
  error?: string
}

export interface FullSyncResult {
  wiki: SyncComponentResult
  inbox: SyncComponentResult
}

/**
 * Wiki content is plain files on disk (no git backup or remote sync).
 * Kept as a no-op so full sync and POST /api/wiki/sync still succeed.
 */
export async function syncWikiFromDisk(): Promise<SyncComponentResult> {
  return { ok: true }
}

/**
 * Run **`refresh`** for the current brain home: in-process TS sync only.
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
    console.error('[brain-app] ensureGoogleOAuthImapSiblingSources (calendar-only refresh):', e)
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
      console.error(`[brain-app] ripmail refresh ${id} failed:`, detail)
      return { ok: false, error: detail }
    }
  }
  return { ok: true }
}

export async function syncInboxRipmail(_signal?: AbortSignal): Promise<SyncComponentResult> {
  try {
    await ensureGoogleOAuthImapSiblingSources(ripmailHomeForBrain())
  } catch (e) {
    console.error('[brain-app] ensureGoogleOAuthImapSiblingSources:', e)
  }
  try {
    await ripmailRefresh(ripmailHomeForBrain())
    await syncMailNotifyNotificationsFromRipmailDbSafe()
    return { ok: true }
  } catch (e) {
    const detail = formatExecError(e)
    console.error('[brain-app] ripmail refresh failed:', detail)
    return { ok: false, error: detail }
  }
}

/** First onboarding pass: bounded window backfill (~30 days) vs full `refresh` defaultSince (~1y). See OPP-093. */
export async function syncInboxRipmailOnboarding(_signal?: AbortSignal): Promise<SyncComponentResult> {
  try {
    await ensureGoogleOAuthImapSiblingSources(ripmailHomeForBrain())
  } catch (e) {
    console.error('[brain-app] ensureGoogleOAuthImapSiblingSources (onboarding sync):', e)
  }
  try {
    // TS sync handles backfill window via config.json sync.defaultSince
    await ripmailRefresh(ripmailHomeForBrain())
    await syncMailNotifyNotificationsFromRipmailDbSafe()
    return { ok: true }
  } catch (e) {
    const detail = formatExecError(e)
    console.error('[brain-app] ripmail refresh (onboarding) failed:', detail)
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
 * Run **`refresh`** and **wait** for it to complete. Lap timeouts use **`timeoutMs`** (in-process TS
 * path does not hard-abort sync today; callers still pass the cap from the supervisor contract).
 */
export async function refreshMailAndWait(
  _timeoutMs = RIPMAIL_REFRESH_TIMEOUT_MS,
  _signal?: AbortSignal,
): Promise<{ ok: boolean; timedOut?: boolean; error?: string }> {
  try {
    await ensureGoogleOAuthImapSiblingSources(ripmailHomeForBrain())
  } catch (e) {
    console.error('[brain-app] ensureGoogleOAuthImapSiblingSources (lap refresh):', e)
  }
  try {
    await ripmailRefresh(ripmailHomeForBrain())
    await syncMailNotifyNotificationsFromRipmailDbSafe()
    return { ok: true }
  } catch (e) {
    if (e instanceof RipmailTimeoutError) {
      return { ok: false, timedOut: true, error: 'refresh timed out' }
    }
    return { ok: false, error: formatExecError(e) }
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
