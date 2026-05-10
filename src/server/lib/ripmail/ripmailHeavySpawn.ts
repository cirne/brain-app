import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { getOnboardingMailStatus } from '@server/lib/onboarding/onboardingMailStatus.js'
import {
  RIPMAIL_BACKFILL_TIMEOUT_MS,
  RIPMAIL_REFRESH_TIMEOUT_MS,
  runRipmailArgv,
  type RipmailRunResult,
} from './ripmailRun.js'
import { syncMailNotifyNotificationsFromRipmailDbSafe } from '@server/lib/notifications/syncMailNotifyNotifications.js'

/** How long to wait for a prior **detached** `ripmail backfill` to release the backfill lane before kicking another. */
const WAIT_BACKFILL_IDLE_DEFAULT_MS = RIPMAIL_BACKFILL_TIMEOUT_MS

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      return
    }
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Poll mail status until the ripmail **backfill** lane is idle (or timeout).
 * Needed when phase‑1 is a **detached** `backfill`: the CLI parent exits immediately, so kicking phase‑2 too soon hits "backfill already running" and drops the job—while the UI can still poll partial progress from the running child.
 */
export async function waitForRipmailBackfillLaneIdle(
  options: {
    pollMs?: number
    maxWaitMs?: number
    signal?: AbortSignal
  } = {},
): Promise<void> {
  const pollMs = options.pollMs ?? 2500
  const maxWaitMs = options.maxWaitMs ?? WAIT_BACKFILL_IDLE_DEFAULT_MS
  const t0 = Date.now()
  for (;;) {
    if (options.signal?.aborted) {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
    const m = await getOnboardingMailStatus()
    if (!m.configured) return
    if (!m.backfillRunning) return
    if (Date.now() - t0 >= maxWaitMs) {
      throw new Error(
        `ripmail backfill lane still busy after ${maxWaitMs}ms — phase-2 backfill not started; clear stale lock or retry`,
      )
    }
    await sleep(pollMs, options.signal)
  }
}

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
  const result = await runRipmailHeavyArgv(argv, {
    timeoutMs,
    label: 'refresh',
    signal,
    ripmailTimeoutSeconds: Math.ceil(timeoutMs / 1000),
  })
  await syncMailNotifyNotificationsFromRipmailDbSafe()
  return result
}

export async function runRipmailBackfillForBrain(
  argvTail: string[],
  signal?: AbortSignal,
): Promise<RipmailRunResult> {
  const timeoutMs = RIPMAIL_BACKFILL_TIMEOUT_MS
  /** Detached default: parent exits quickly (~ms); real work runs in child so UIs can poll `status` for progress. Pair onboarding phase‑2 with {@link waitForRipmailBackfillLaneIdle} so the second backfill is not dropped while phase‑1 still holds the lane. */
  const argv = ['backfill', ...argvTail]
  const result = await runRipmailHeavyArgv(argv, {
    timeoutMs,
    label: 'backfill',
    signal,
    ripmailTimeoutSeconds: Math.ceil(timeoutMs / 1000),
  })
  await syncMailNotifyNotificationsFromRipmailDbSafe()
  return result
}
