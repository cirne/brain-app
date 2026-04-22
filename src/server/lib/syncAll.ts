import process from 'node:process'
export { ripmailProcessEnv as ripmailRefreshEnv } from './ripmailExec.js'
import { formatExecError } from './execError.js'
import { ripmailHomeForBrain } from './brainHome.js'
import { ensureGoogleCalendarSourcesForOAuthImap } from './googleOAuth.js'
import { RipmailTimeoutError, RIPMAIL_REFRESH_TIMEOUT_MS } from './ripmailExec.js'
import { runRipmailHeavyArgv, runRipmailRefreshForBrain } from './ripmailHeavySpawn.js'

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
 * Run `ripmail refresh` for the current brain home: single-flight per home+argv, hard timeout,
 * always wait for exit (no detached spawn).
 */
export async function syncInboxRipmail(signal?: AbortSignal): Promise<SyncComponentResult> {
  try {
    await ensureGoogleCalendarSourcesForOAuthImap(ripmailHomeForBrain())
  } catch (e) {
    console.error('[brain-app] ensureGoogleCalendarSourcesForOAuthImap:', e)
  }
  try {
    await runRipmailRefreshForBrain([], signal)
    return { ok: true }
  } catch (e) {
    const detail = formatExecError(e)
    console.error('[brain-app] ripmail refresh failed:', detail)
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
 * Run `ripmail refresh` and **wait** for it to complete. Uses the same single-flight + timeout
 * path as other refresh triggers when `timeoutMs` matches the global refresh cap; the lap uses an
 * explicit shorter cap by passing `timeoutMs`.
 */
export async function refreshMailAndWait(
  timeoutMs = RIPMAIL_REFRESH_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<{ ok: boolean; timedOut?: boolean; error?: string }> {
  try {
    await ensureGoogleCalendarSourcesForOAuthImap(ripmailHomeForBrain())
  } catch (e) {
    console.error('[brain-app] ensureGoogleCalendarSourcesForOAuthImap (lap refresh):', e)
  }
  try {
    await runRipmailHeavyArgv(['refresh'], {
      timeoutMs,
      label: 'refresh-lap',
      signal,
      ripmailTimeoutSeconds: Math.max(1, Math.ceil(timeoutMs / 1000)),
    })
    return { ok: true }
  } catch (e) {
    if (e instanceof RipmailTimeoutError) {
      return { ok: true, timedOut: true }
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
