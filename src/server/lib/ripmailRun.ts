import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { ripmailBin } from './ripmailBin.js'
import { ripmailProcessEnv } from './brainHome.js'

const KILL_ESCALATION_MS = 5000

/** Default exec budget for typical ripmail queries (search, inbox list, …). */
export const RIPMAIL_QUERY_TIMEOUT_MS = 60_000
/** First-time / large-mailbox IMAP sync — matches `RIPMAIL_TIMEOUT` we forward to the child. */
export const RIPMAIL_REFRESH_TIMEOUT_MS = 2 * 60 * 60 * 1000
export const RIPMAIL_BACKFILL_TIMEOUT_MS = RIPMAIL_REFRESH_TIMEOUT_MS
/** `ripmail status --json` may block while sync holds the DB. */
export const RIPMAIL_STATUS_TIMEOUT_MS = 120_000

const tracked = new Set<ChildProcess>()

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

function logRipmailLine(payload: Record<string, unknown>): void {
  console.log(JSON.stringify({ tag: '[ripmail]', ...payload }))
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

  logRipmailLine({
    phase: 'spawn',
    label,
    argv: [bin, ...argv],
    pid: child.pid,
    timeoutMs: options.timeoutMs,
  })

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
        logRipmailLine({
          phase: 'close',
          label,
          argv: [bin, ...argv],
          pid: r.pid,
          code: r.code,
          signal: r.signal,
          durationMs,
          timedOut: r.timedOut,
        })

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
