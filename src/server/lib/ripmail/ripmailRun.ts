import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { ripmailBin } from './ripmailBin.js'
import { buildRipmailStatusLogSnapshot } from './ripmailStatusParse.js'
import { ripmailProcessEnv } from '@server/lib/platform/brainHome.js'

const KILL_ESCALATION_MS = 5000

/** Default exec budget for typical ripmail queries (search, inbox list, …). */
export const RIPMAIL_QUERY_TIMEOUT_MS = 60_000
/** First-time / large-mailbox IMAP sync — matches `RIPMAIL_TIMEOUT` we forward to the child. */
export const RIPMAIL_REFRESH_TIMEOUT_MS = 2 * 60 * 60 * 1000
export const RIPMAIL_BACKFILL_TIMEOUT_MS = RIPMAIL_REFRESH_TIMEOUT_MS
/** `ripmail status --json` may block while sync holds the DB. */
export const RIPMAIL_STATUS_TIMEOUT_MS = 120_000
/** Outbound SMTP: normally sub-second; cap long hangs (TCP/TLS stuck) with a hard kill. */
export const RIPMAIL_SEND_TIMEOUT_MS = 30_000

/** Max chars per stream embedded in JSON diagnostic logs (NR / docker). */
const RIPMAIL_DIAGNOSTIC_TAIL_CHARS = 6000

const tracked = new Set<ChildProcess>()

function tailForDiagnosticLog(s: string, max = RIPMAIL_DIAGNOSTIC_TAIL_CHARS): string {
  if (s.length <= max) return s
  return `\u2026${s.slice(-max)}`
}

let spawnCount = 0
let closeCount = 0
let timeoutKillCount = 0

export class RipmailNonZeroExitError extends Error {
  readonly result: RipmailRunResult

  constructor(result: RipmailRunResult) {
    super(
      `ripmail exited ${result.code} signal=${result.signal ?? 'none'} stderr=${result.stderr.slice(0, 500)}`,
    )
    this.name = 'RipmailNonZeroExitError'
    this.result = result
  }
}

export class RipmailTimeoutError extends Error {
  readonly result: RipmailRunResult

  constructor(result: RipmailRunResult) {
    super(`ripmail timed out after ${result.durationMs}ms`)
    this.name = 'RipmailTimeoutError'
    this.result = result
  }
}

/** Subprocess exit/kill signal shape without referencing the NodeJS global (eslint). */
type RipmailSignal = NonNullable<Parameters<ChildProcess['kill']>[0]> | null

export type RipmailRunResult = {
  stdout: string
  stderr: string
  code: number | null
  signal: RipmailSignal
  durationMs: number
  timedOut: boolean
  pid: number | undefined
}

export type RipmailRunOptions = {
  timeoutMs: number
  maxBuffer?: number
  env?: NonNullable<SpawnOptions['env']>
  cwd?: string
  signal?: AbortSignal
  /** When set, passed to ripmail as `RIPMAIL_TIMEOUT` (seconds) unless already in env */
  ripmailTimeoutSeconds?: number
  /** Log label for observability */
  label?: string
}

export function getRipmailChildDebugSnapshot(): {
  inFlight: number
  spawnCount: number
  closeCount: number
  timeoutKillCount: number
  pids: number[]
} {
  return {
    inFlight: tracked.size,
    spawnCount,
    closeCount,
    timeoutKillCount,
    pids: [...tracked].map((c) => c.pid).filter((p): p is number => typeof p === 'number'),
  }
}

/** Best-effort: reap tracked children. Prefer SIGTERM; escalation already done per timed-out run. */
export function terminateAllTrackedRipmailChildren(
  signo: NonNullable<Parameters<ChildProcess['kill']>[0]> = 'SIGTERM',
): void {
  for (const c of tracked) {
    try {
      c.kill(signo)
    } catch {
      /* ignore */
    }
  }
}

/** Log-friendly shell quoting (POSIX-style) for argv fragments. */
function formatRipmailCommandLine(parts: string[]): string {
  return parts
    .map((p) => {
      if (p === '') return "''"
      if (/^[\w@%+=:,./-]+$/i.test(p)) return p
      return `'${p.replace(/'/g, `'"'"'`)}'`
    })
    .join(' ')
}

/**
 * Human-oriented ripmail logs: one line with the full command and compact inline JSON metadata
 * (`argv` is only on the command line, not repeated in JSON).
 */
function logRipmailLine(payload: Record<string, unknown>): void {
  const argvRaw = payload.argv
  const parts = Array.isArray(argvRaw) ? (argvRaw as string[]) : []
  const cmdLine = parts.length > 0 ? formatRipmailCommandLine(parts) : '(ripmail argv missing)'
  const { argv: _omitArgv, ...meta } = payload
  const doc = { tag: '[ripmail]', ...meta }
  console.log(`[ripmail] ${cmdLine} ${JSON.stringify(doc)}`)
}

/**
 * When `errors`, only log ripmail spawn/close for failures, timeouts, or `send` — successful
 * search/read noise is omitted (useful during JSONL evals with high concurrency).
 * Env: `BRAIN_RIPMAIL_SUBPROCESS_LOG` = `errors` | `0` | `off`.
 */
function ripmailSubprocessLogErrorsOnly(): boolean {
  const v = process.env.BRAIN_RIPMAIL_SUBPROCESS_LOG?.trim().toLowerCase()
  return v === 'errors' || v === 'error' || v === '0' || v === 'off'
}

/**
 * Run ripmail with argv (no shell). Rejects on spawn error, abort, timeout, or nonzero exit.
 */
export async function runRipmailArgv(
  argv: string[],
  options: RipmailRunOptions,
): Promise<RipmailRunResult> {
  const bin = ripmailBin()
  const maxBuffer = options.maxBuffer ?? 1024 * 1024
  const label = options.label ?? argv[0] ?? 'ripmail'
  const mergedEnv = {
    ...ripmailProcessEnv(),
    ...options.env,
  }
  const secs =
    options.ripmailTimeoutSeconds ?? Math.max(1, Math.ceil(options.timeoutMs / 1000))
  if (mergedEnv.RIPMAIL_TIMEOUT === undefined) {
    mergedEnv.RIPMAIL_TIMEOUT = String(secs)
  }
  const ripmailTimeoutEnvSec = mergedEnv.RIPMAIL_TIMEOUT
  const ripErrorsOnly = ripmailSubprocessLogErrorsOnly()

  const t0 = Date.now()
  if (options.signal?.aborted) {
    throw Object.assign(new Error('ripmail aborted'), { name: 'AbortError' })
  }

  spawnCount += 1

  const child = spawn(bin, argv, {
    env: mergedEnv,
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  tracked.add(child)

  if (!ripErrorsOnly) {
    logRipmailLine({
      phase: 'spawn',
      label,
      argv: [bin, ...argv],
      pid: child.pid,
      /** Same store Brain uses (`ripmailProcessEnv()`); ripmail has no global `--home` flag. */
      RIPMAIL_HOME: mergedEnv.RIPMAIL_HOME,
      timeoutMs: options.timeoutMs,
      ripmailTimeoutEnvSec,
    })
  }

  let stdout = ''
  let stderr = ''
  let timedOut = false
  let aborted = false
  let killEscalation: ReturnType<typeof setTimeout> | undefined
  let maxBufferExceeded = false
  let settled = false

  const cleanupListeners = (): void => {
    child.stdout?.removeAllListeners()
    child.stderr?.removeAllListeners()
    child.removeAllListeners()
  }

  return await new Promise<RipmailRunResult>((resolve, reject) => {
      const settleClosed = (code: number | null, signal: RipmailSignal) => {
        if (settled) return
        settled = true
        cleanupListeners()
        if (killEscalation) clearTimeout(killEscalation)
        tracked.delete(child)
        closeCount += 1
        const durationMs = Date.now() - t0
        const r: RipmailRunResult = {
          stdout,
          stderr,
          code,
          signal,
          durationMs,
          timedOut,
          pid: child.pid,
        }
        const stderrLen = stderr.length
        const stdoutLen = stdout.length
        const logOutputDiagnostics =
          r.timedOut ||
          r.signal !== null ||
          (r.code !== null && r.code !== 0) ||
          label === 'send'
        const closePayload: Record<string, unknown> = {
          phase: 'close',
          label,
          argv: [bin, ...argv],
          RIPMAIL_HOME: mergedEnv.RIPMAIL_HOME,
          pid: r.pid,
          code: r.code,
          signal: r.signal,
          durationMs,
          timedOut: r.timedOut,
          stdoutChars: stdoutLen,
          stderrChars: stderrLen,
        }
        if (logOutputDiagnostics) {
          closePayload.stdoutTail = tailForDiagnosticLog(stdout)
          closePayload.stderrTail = tailForDiagnosticLog(stderr)
        }
        if (label === 'status' && r.code === 0 && stdoutLen > 0) {
          closePayload.syncStatus = buildRipmailStatusLogSnapshot(stdout)
        }
        if (r.timedOut && stderrLen === 0 && stdoutLen === 0) {
          closePayload.diagnosticHint =
            'ripmail produced no output before Node timeout — likely blocked before first progress line (wrong binary, crash on startup, or stderr not captured); confirm container ripmail build and RIPMAIL_HOME'
        } else if (r.timedOut && stderrLen > 0) {
          const tail = stderr.slice(-4000)
          if (tail.includes('sending message via SMTP')) {
            closePayload.diagnosticHint =
              'last progress: about to submit to SMTP — hang is likely TCP/TLS to the SMTP host, DNS, firewall, or the server not completing the transaction'
          } else if (
            tail.includes('fetching Google OAuth') &&
            !tail.includes('OAuth token received')
          ) {
            closePayload.diagnosticHint =
              'hang during Google OAuth token fetch — check network egress, clock skew, refresh token, and Google API reachability from the container'
          } else if (tail.includes('OAuth token received')) {
            closePayload.diagnosticHint =
              'OAuth succeeded; hang is likely while opening TLS or authenticating to the SMTP relay'
          } else if (tail.includes('constructing SMTP transport')) {
            closePayload.diagnosticHint =
              'hang while building/connecting SMTP transport (can include implicit STARTTLS negotiation depending on lettre behavior)'
          } else if (tail.includes('loading threading from SQLite') || tail.includes('maildir')) {
            closePayload.diagnosticHint =
              'hang during reply threading — SQLite open/read may be blocked if another ripmail process holds the DB lock'
          }
        }

        if (!(ripErrorsOnly && !logOutputDiagnostics)) {
          logRipmailLine(closePayload)
        }

        if (maxBufferExceeded) {
          reject(
            Object.assign(new Error(`ripmail maxBuffer exceeded (cap ${maxBuffer})`), {
              name: 'MaxBufferError',
            }),
          )
          return
        }
        if (aborted) {
          reject(Object.assign(new Error('ripmail aborted'), { name: 'AbortError' }))
          return
        }
        if (timedOut) {
          reject(new RipmailTimeoutError(r))
          return
        }
        if (code !== 0 && code !== null) {
          reject(new RipmailNonZeroExitError(r))
          return
        }
        resolve(r)
      }

      const onAbort = () => {
        aborted = true
        try {
          child.kill('SIGTERM')
        } catch {
          /* ignore */
        }
      }

      if (options.signal) {
        if (options.signal.aborted) {
          aborted = true
          try {
            child.kill('SIGTERM')
          } catch {
            /* ignore */
          }
        } else {
          options.signal.addEventListener('abort', onAbort, { once: true })
        }
      }

      const timer = setTimeout(() => {
        timedOut = true
        timeoutKillCount += 1
        try {
          child.kill('SIGTERM')
        } catch {
          /* ignore */
        }
        killEscalation = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            /* ignore */
          }
        }, KILL_ESCALATION_MS)
      }, options.timeoutMs)

      const onChunk = (buf: Buffer, which: 'stdout' | 'stderr') => {
        if (settled) return
        const chunk = buf.toString('utf8')
        if (which === 'stdout') stdout += chunk
        else stderr += chunk
        const total = stdout.length + stderr.length
        if (total > maxBuffer) {
          maxBufferExceeded = true
          clearTimeout(timer)
          timedOut = true
          timeoutKillCount += 1
          try {
            child.kill('SIGKILL')
          } catch {
            /* ignore */
          }
        }
      }

      child.stdout?.on('data', (b) => onChunk(b, 'stdout'))
      child.stderr?.on('data', (b) => onChunk(b, 'stderr'))

      child.once('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (options.signal) options.signal.removeEventListener('abort', onAbort)
        cleanupListeners()
        if (killEscalation) clearTimeout(killEscalation)
        tracked.delete(child)
        closeCount += 1
        reject(err)
      })

      child.once('close', (code, signal) => {
        clearTimeout(timer)
        if (options.signal) options.signal.removeEventListener('abort', onAbort)
        settleClosed(code, signal)
      })
    })
}
