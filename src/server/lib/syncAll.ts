import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { parseICS, writeCache } from './calendarCache.js'
import { ripmailBin } from './ripmailBin.js'

const execAsync = promisify(exec)

export interface SyncComponentResult {
  ok: boolean
  error?: string
}

export interface FullSyncResult {
  wiki: SyncComponentResult
  inbox: SyncComponentResult
  calendar: SyncComponentResult
}

async function fetchAndCacheCalendar(source: 'travel' | 'personal', url: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${source} calendar`)
  const text = await res.text()
  const events = parseICS(text, source)
  await writeCache(source, events)
}

/** Commit if dirty, pull --rebase --autostash, push (same as POST /api/wiki/sync). */
export async function syncWikiFromDisk(): Promise<SyncComponentResult> {
  const dir = repoDir()
  const git = (cmd: string) =>
    execAsync(`git -C ${JSON.stringify(dir)} ${cmd}`, {
      timeout: 120000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
  try {
    await git('add -A')
    const { stdout: status } = await git('status --porcelain')
    if (status.trim()) {
      const date = new Date().toISOString().slice(0, 16).replace('T', ' ')
      await git(`commit -m ${JSON.stringify(`auto-sync: ${date}`)}`)
    }

    await git('pull --rebase --autostash')

    try {
      await git('push')
    } catch {
      /* nothing to push or no upstream */
    }

    return { ok: true }
  } catch (e) {
    const detail = formatExecError(e)
    console.error('[brain-app] wiki sync failed:', detail)
    return { ok: false, error: detail }
  }
}

/**
 * Kick off `ripmail refresh` without blocking. The CLI may keep running a supervisor
 * while sync continues; `exec()` would wait on that process — use a detached spawn instead.
 */
export async function syncInboxRipmail(): Promise<SyncComponentResult> {
  const rm = ripmailBin()
  return new Promise((resolve) => {
    const child = spawn(rm, ['refresh'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    })
    const done = (result: SyncComponentResult) => {
      child.removeAllListeners()
      resolve(result)
    }
    child.once('error', (err) => {
      const detail = formatExecError(err)
      console.error('[brain-app] inbox sync failed:', detail)
      done({ ok: false, error: detail })
    })
    child.once('spawn', () => {
      child.unref()
      done({ ok: true })
    })
  })
}

/** Fetch configured ICS URLs and update local calendar cache. */
export async function syncCalendarFromEnv(): Promise<SyncComponentResult> {
  const travelUrl = process.env.CIRNE_TRAVEL_ICS_URL
  const personalUrl = process.env.LEW_PERSONAL_ICS_URL

  const results = await Promise.allSettled([
    travelUrl ? fetchAndCacheCalendar('travel', travelUrl) : Promise.resolve(),
    personalUrl ? fetchAndCacheCalendar('personal', personalUrl) : Promise.resolve(),
  ])

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => String(r.reason?.message ?? r.reason))

  if (errors.length > 0) {
    const detail = errors.join('; ')
    console.error('[brain-app] calendar sync failed:', detail)
    return { ok: false, error: detail }
  }

  return { ok: true }
}

/**
 * Wiki + inbox + calendar. Does not throw — callers log per-component results.
 */
export async function runFullSync(): Promise<FullSyncResult> {
  const [wiki, inbox, calendar] = await Promise.all([
    syncWikiFromDisk(),
    syncInboxRipmail(),
    syncCalendarFromEnv(),
  ])
  return { wiki, inbox, calendar }
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
