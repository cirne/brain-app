import { ripmailHomeForBrain } from './brainHome.js'
import {
  RIPMAIL_BACKFILL_TIMEOUT_MS,
  RIPMAIL_REFRESH_TIMEOUT_MS,
  runRipmailArgv,
  type RipmailRunResult,
} from './ripmailRun.js'

/** Serialize + dedupe concurrent identical argv per ripmail home (refresh/backfill). */
const chainTail = new Map<string, Promise<unknown>>()
const inflightByHomeArgv = new Map<string, Promise<unknown>>()

function coalesceKey(home: string, argv: string[]): string {
  return `${home}\0${argv.join('\0')}`
}

export async function runRipmailHeavyArgv(
  argv: string[],
  options: {
    timeoutMs: number
    label?: string
    signal?: AbortSignal
    ripmailTimeoutSeconds?: number
  },
): Promise<RipmailRunResult> {
  const home = ripmailHomeForBrain()
  const ck = coalesceKey(home, argv)

  const prev = chainTail.get(home) ?? Promise.resolve()
  const work = prev.catch(() => {}).then(async () => {
    const existing = inflightByHomeArgv.get(ck) as Promise<RipmailRunResult> | undefined
    if (existing) return existing
    const secs =
      options.ripmailTimeoutSeconds ?? Math.max(1, Math.ceil(options.timeoutMs / 1000))
    const argvWithTimeout = ['--timeout', String(secs), ...argv] as string[]
    const p = runRipmailArgv(argvWithTimeout, {
      timeoutMs: options.timeoutMs,
      label: options.label,
      signal: options.signal,
      ripmailTimeoutSeconds: options.ripmailTimeoutSeconds,
    }).finally(() => {
      if (inflightByHomeArgv.get(ck) === p) inflightByHomeArgv.delete(ck)
    })
    inflightByHomeArgv.set(ck, p)
    return p
  }) as Promise<RipmailRunResult>

  chainTail.set(
    home,
    work.then(
      () => undefined,
      () => undefined,
    ),
  )
  return work
}

export async function runRipmailRefreshForBrain(
  extraArgv: string[] = [],
  signal?: AbortSignal,
): Promise<RipmailRunResult> {
  const timeoutMs = RIPMAIL_REFRESH_TIMEOUT_MS
  const argv = ['refresh', ...extraArgv]
  return runRipmailHeavyArgv(argv, {
    timeoutMs,
    label: 'refresh',
    signal,
    ripmailTimeoutSeconds: Math.ceil(timeoutMs / 1000),
  })
}

export async function runRipmailBackfillForBrain(
  argvTail: string[],
  signal?: AbortSignal,
): Promise<RipmailRunResult> {
  const timeoutMs = RIPMAIL_BACKFILL_TIMEOUT_MS
  const argv = ['backfill', ...argvTail]
  return runRipmailHeavyArgv(argv, {
    timeoutMs,
    label: 'backfill',
    signal,
    ripmailTimeoutSeconds: Math.ceil(timeoutMs / 1000),
  })
}
