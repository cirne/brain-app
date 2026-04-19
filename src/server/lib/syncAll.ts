import process from 'node:process'
import { spawn } from 'node:child_process'
import { formatExecError } from './execError.js'
import { ripmailHomeForBrain } from './brainHome.js'
import { ensureGoogleCalendarSourcesForOAuthImap } from './googleOAuth.js'
import { ripmailBin } from './ripmailBin.js'
import { ripmailProcessEnv } from './ripmailExec.js'

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
 * Kick off `ripmail refresh` without blocking. Syncs mail, calendar sources, local dirs, etc.
 * The CLI may keep running a supervisor while sync continues; use a detached spawn instead of `exec()`.
 */
export function ripmailRefreshEnv(): typeof process.env {
  return ripmailProcessEnv()
}

export async function syncInboxRipmail(): Promise<SyncComponentResult> {
  try {
    await ensureGoogleCalendarSourcesForOAuthImap(ripmailHomeForBrain())
  } catch (e) {
    console.error('[brain-app] ensureGoogleCalendarSourcesForOAuthImap:', e)
  }
  const rm = ripmailBin()
  return new Promise((resolve) => {
    const child = spawn(rm, ['refresh'], {
      detached: true,
      stdio: 'ignore',
      env: ripmailRefreshEnv(),
    })
    const done = (result: SyncComponentResult) => {
      child.removeAllListeners()
      resolve(result)
    }
    child.once('error', (err) => {
      const detail = formatExecError(err)
      console.error('[brain-app] ripmail refresh failed:', detail)
      done({ ok: false, error: detail })
    })
    child.once('spawn', () => {
      child.unref()
      done({ ok: true })
    })
  })
}

/**
 * Wiki + ripmail refresh (includes indexed calendar). Does not throw — callers log per-component results.
 */
export async function runFullSync(): Promise<FullSyncResult> {
  const [wiki, inbox] = await Promise.all([syncWikiFromDisk(), syncInboxRipmail()])
  return { wiki, inbox }
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
