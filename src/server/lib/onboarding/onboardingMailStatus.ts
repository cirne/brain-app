import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  computeIndexingActionHint,
  listRipmailStatusAnomalies,
  parseRipmailStatusJson,
  type ParsedRipmailStatus,
} from '@server/lib/ripmail/ripmailStatusParse.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { execRipmailAsync, RIPMAIL_STATUS_TIMEOUT_MS } from '@server/lib/ripmail/ripmailRun.js'
import { ripmailBin } from '@server/lib/ripmail/ripmailBin.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export { ripmailBin }

export function ripmailHomePath(): string {
  return ripmailHomeForBrain()
}

export type OnboardingMailStatusPayload = {
  configured: boolean
  indexedTotal: number | null
  lastSyncedAt: string | null
  dateRange: { from: string | null; to: string | null }
  syncRunning: boolean
  /** `sync.refresh` lane only (nested or legacy flat). */
  refreshRunning: boolean
  /** `sync.backfill` lane running; absent lane → always false from parse. */
  backfillRunning: boolean
  /** From `ripmail status --json` `sync.lockAgeMs` — how long the current sync has held the lock. */
  syncLockAgeMs: number | null
  ftsReady: number | null
  /** Denominator for indexed / total during onboarding (same as parsed mail status). */
  messageAvailableForProgress: number | null
  /** Mailbox still needs data and no sync is active — resume candidate (see backfill supervisor). */
  pendingBackfill: boolean
  /** Stale lock row without a live process — do not stack refreshes until cleared. */
  staleMailSyncLock: boolean
  /** Actionable line for the indexing hero (stale lock, hang suspected); null when nothing urgent. */
  indexingHint?: string | null
  statusError?: string
}

/** `off` (default) | `summary` | `full` — set ONBOARDING_MAIL_DEBUG=summary|1|full|true */
export function onboardingMailDebugLevelFromEnv(v: string | undefined): 'off' | 'summary' | 'full' {
  if (v === undefined || v === '' || v === '0' || v === 'false') return 'off'
  if (v === 'summary') return 'summary'
  if (v === '1' || v === 'true' || v === 'full') return 'full'
  return 'off'
}

function onboardingMailDebugLevel(): 'off' | 'summary' | 'full' {
  return onboardingMailDebugLevelFromEnv(process.env.ONBOARDING_MAIL_DEBUG)
}

/** Avoid spam when Hub polls every few seconds. */
const RIPMAIL_ANOMALY_WARN_COOLDOWN_MS = 90_000
let lastRipmailAnomalyWarnKey = ''
let lastRipmailAnomalyWarnAt = 0

function maybeWarnRipmailStatusAnomalies(parsed: ParsedRipmailStatus, execMs: number): void {
  const anomalies = listRipmailStatusAnomalies(parsed)
  if (anomalies.length === 0) return
  const key = anomalies.join(',')
  const now = Date.now()
  if (key === lastRipmailAnomalyWarnKey && now - lastRipmailAnomalyWarnAt < RIPMAIL_ANOMALY_WARN_COOLDOWN_MS) {
    return
  }
  lastRipmailAnomalyWarnKey = key
  lastRipmailAnomalyWarnAt = now
  brainLogger.warn(
    {
      msg: 'ripmail status poll: unusual parsed state',
      anomalies,
      execMs,
      syncRunning: parsed.syncRunning,
      refreshRunning: parsed.refreshRunning,
      backfillRunning: parsed.backfillRunning,
      syncLockAgeMs: parsed.syncLockAgeMs,
      staleLockInDb: parsed.staleLockInDb,
      initialSyncHangSuspected: parsed.initialSyncHangSuspected,
    },
    'onboarding/mail',
  )
}

function logOnboardingMailDebug(
  phase: string,
  data: Record<string, unknown>,
  level: 'summary' | 'full',
): void {
  const want = onboardingMailDebugLevel()
  if (want === 'off') return
  if (level === 'full' && want !== 'full') return
  const logFn = level === 'full' ? brainLogger.trace.bind(brainLogger) : brainLogger.debug.bind(brainLogger)
  logFn({ phase, ...data }, 'onboarding/mail')
}

/** Runs `ripmail status --json` only — lightweight poll for onboarding progress. */
export async function getOnboardingMailStatus(): Promise<OnboardingMailStatusPayload> {
  const configPath = join(ripmailHomePath(), 'config.json')
  const configured = existsSync(configPath)

  const empty: OnboardingMailStatusPayload = {
    configured,
    indexedTotal: null,
    lastSyncedAt: null,
    dateRange: { from: null, to: null },
    syncRunning: false,
    refreshRunning: false,
    backfillRunning: false,
    syncLockAgeMs: null,
    ftsReady: null,
    messageAvailableForProgress: null,
    pendingBackfill: false,
    staleMailSyncLock: false,
    indexingHint: null,
  }

  if (!configured) {
    logOnboardingMailDebug(
      'skip',
      { reason: 'no config.json', ripmailHome: ripmailHomePath() },
      'summary',
    )
    return empty
  }

  const t0 = performance.now()
  try {
    const { stdout } = await execRipmailAsync(`${ripmailBin()} status --json`, {
      timeout: RIPMAIL_STATUS_TIMEOUT_MS,
    })
    const ms = Math.round(performance.now() - t0)
    const maxRaw = 6000
    const rawTruncated = stdout.length > maxRaw
    const rawPreview = rawTruncated ? `${stdout.slice(0, maxRaw)}…` : stdout

    let syncSnippet: Record<string, unknown> | null = null
    let mailboxesSnippet: unknown = null
    try {
      const j = JSON.parse(stdout) as Record<string, unknown>
      const sync = j.sync as Record<string, unknown> | undefined
      if (sync && typeof sync === 'object') {
        syncSnippet = {
          isRunning: sync.isRunning,
          lastSyncAt: sync.lastSyncAt,
          totalMessages: sync.totalMessages,
          earliestSyncedDate: sync.earliestSyncedDate,
          latestSyncedDate: sync.latestSyncedDate,
          lockAgeMs: sync.lockAgeMs,
        }
      }
      if (Array.isArray(j.mailboxes)) {
        mailboxesSnippet = j.mailboxes.map((m: unknown) => {
          const o = m as Record<string, unknown>
          return {
            email: o.email,
            messageCount: o.messageCount,
            needsBackfill: o.needsBackfill,
          }
        })
      }
    } catch {
      /* ignore parse for debug */
    }

    const parsed = parseRipmailStatusJson(stdout)
    logOnboardingMailDebug(
      'poll',
      {
        execMs: ms,
        stdoutBytes: stdout.length,
        sync: syncSnippet,
        mailboxes: mailboxesSnippet,
        parsed,
      },
      'summary',
    )
    if (onboardingMailDebugLevel() === 'full') {
      logOnboardingMailDebug(
        'poll-raw',
        { rawTruncated, rawJson: rawPreview },
        'full',
      )
    }

    if (parsed) {
      maybeWarnRipmailStatusAnomalies(parsed, ms)
      const payload: OnboardingMailStatusPayload = {
        configured: true,
        indexedTotal: parsed.indexedTotal,
        lastSyncedAt: parsed.lastSyncedAt,
        dateRange: parsed.dateRange,
        syncRunning: parsed.syncRunning,
        refreshRunning: parsed.refreshRunning,
        backfillRunning: parsed.backfillRunning,
        syncLockAgeMs: parsed.syncLockAgeMs,
        ftsReady: parsed.ftsReady,
        messageAvailableForProgress: parsed.messageAvailableForProgress,
        pendingBackfill: parsed.pendingRefresh,
        staleMailSyncLock: parsed.staleLockInDb,
        indexingHint: computeIndexingActionHint(parsed),
      }
      return payload
    }
    logOnboardingMailDebug('parse failed', { execMs: ms, hint: 'parseRipmailStatusJson returned null' }, 'summary')
    return { ...empty, statusError: 'Could not parse mail status' }
  } catch (e) {
    const ms = Math.round(performance.now() - t0)
    logOnboardingMailDebug(
      'exec error',
      {
        execMs: ms,
        error: e instanceof Error ? e.message : String(e),
      },
      'summary',
    )
    return { ...empty, statusError: e instanceof Error ? e.message : String(e) }
  }
}
