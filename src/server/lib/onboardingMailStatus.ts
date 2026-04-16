import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseRipmailStatusJson } from './ripmailStatusParse.js'
import { ripmailBin } from './ripmailBin.js'

const execAsync = promisify(exec)

export { ripmailBin }

export function ripmailHomePath(): string {
  return process.env.RIPMAIL_HOME ?? `${process.env.HOME ?? ''}/.ripmail`
}

export type OnboardingMailStatusPayload = {
  configured: boolean
  indexedTotal: number | null
  lastSyncedAt: string | null
  dateRange: { from: string | null; to: string | null }
  syncRunning: boolean
  ftsReady: number | null
  statusError?: string
}

const envWithRipmailHome = () => ({ ...process.env, RIPMAIL_HOME: ripmailHomePath() })

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

function logOnboardingMailDebug(
  phase: string,
  data: Record<string, unknown>,
  level: 'summary' | 'full',
): void {
  const want = onboardingMailDebugLevel()
  if (want === 'off') return
  if (level === 'full' && want !== 'full') return
  const line = JSON.stringify({ tag: '[onboarding/mail]', phase, ...data })
  console.log(line)
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
    ftsReady: null,
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
    const { stdout } = await execAsync(`${ripmailBin()} status --json`, {
      timeout: 10000,
      env: envWithRipmailHome(),
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
      const payload: OnboardingMailStatusPayload = {
        configured: true,
        indexedTotal: parsed.indexedTotal,
        lastSyncedAt: parsed.lastSyncedAt,
        dateRange: parsed.dateRange,
        syncRunning: parsed.syncRunning,
        ftsReady: parsed.ftsReady,
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
