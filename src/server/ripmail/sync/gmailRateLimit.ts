/**
 * Gmail API quota error detection, retry with truncated exponential backoff,
 * and a token bucket for backfill `messages.get` (5 quota units each).
 */

/** Quota units per `users.messages.get`. */
export const GMAIL_MESSAGES_GET_QUOTA_UNITS = 5

/** Default sustained backfill budget (~30 gets/sec). */
export const GMAIL_BACKFILL_QUOTA_UNITS_PER_SEC = 150

export type GmailRetryLane = 'refresh' | 'backfill'

export type SleepFn = (ms: number) => Promise<void>

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function errorCode(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code: unknown }).code
    if (typeof c === 'number') return c
    if (typeof c === 'string' && /^\d+$/.test(c)) return Number(c)
  }
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { status?: number } }).response
    if (typeof resp?.status === 'number') return resp.status
  }
  return undefined
}

function errorReasons(err: unknown): string[] {
  const reasons: string[] = []
  if (err && typeof err === 'object' && 'errors' in err) {
    const errors = (err as { errors?: Array<{ reason?: string }> }).errors
    if (Array.isArray(errors)) {
      for (const e of errors) {
        if (e?.reason) reasons.push(e.reason)
      }
    }
  }
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: { error?: { errors?: Array<{ reason?: string }> } } } })
      .response?.data?.error?.errors
    if (Array.isArray(data)) {
      for (const e of data) {
        if (e?.reason) reasons.push(e.reason)
      }
    }
  }
  return reasons
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** True when the error is Gmail quota / rate-limit shaped (retryable). */
export function isGmailQuotaError(err: unknown): boolean {
  const code = errorCode(err)
  if (code === 429) return true

  const reasons = errorReasons(err)
  if (
    reasons.some((r) =>
      ['userRateLimitExceeded', 'rateLimitExceeded', 'quotaExceeded'].includes(r),
    )
  ) {
    return true
  }

  const msg = errorMessage(err).toLowerCase()
  return (
    msg.includes('quota exceeded') ||
    msg.includes('user rate limit') ||
    msg.includes('rate limit exceeded') ||
    msg.includes('too many concurrent requests') ||
    msg.includes('resource has been exhausted')
  )
}

export type WithGmailRetryOptions = {
  maxAttempts?: number
  maxBackoffMs?: number
  lane?: GmailRetryLane
  sleep?: SleepFn
}

/**
 * Run `fn` with truncated exponential backoff on Gmail quota errors.
 * Non-quota errors fail immediately.
 */
export async function withGmailRetry<T>(
  fn: () => Promise<T>,
  opts?: WithGmailRetryOptions,
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 5
  const maxBackoffMs = opts?.maxBackoffMs ?? 32_000
  const sleep = opts?.sleep ?? defaultSleep

  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isGmailQuotaError(e) || attempt >= maxAttempts - 1) {
        throw e
      }
      const baseMs = Math.min(2 ** attempt * 1000, maxBackoffMs)
      const jitter = Math.floor(Math.random() * 1000)
      await sleep(baseMs + jitter)
    }
  }
  throw lastErr
}

/**
 * Token bucket limiting Gmail quota units (e.g. 5 per messages.get).
 */
export class GmailQuotaTokenBucket {
  private tokens: number
  private lastRefillMs: number

  constructor(
    private readonly unitsPerSecond: number,
    private readonly maxBurstUnits: number = unitsPerSecond,
  ) {
    this.tokens = maxBurstUnits
    this.lastRefillMs = Date.now()
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefillMs) / 1000
    if (elapsed <= 0) return
    this.tokens = Math.min(this.maxBurstUnits, this.tokens + elapsed * this.unitsPerSecond)
    this.lastRefillMs = now
  }

  /** Wait until `units` can be consumed, then deduct. */
  async acquire(units: number, sleep: SleepFn = defaultSleep): Promise<void> {
    const need = Math.max(1, units)
    for (;;) {
      this.refill()
      if (this.tokens >= need) {
        this.tokens -= need
        return
      }
      const deficit = need - this.tokens
      const waitMs = Math.ceil((deficit / this.unitsPerSecond) * 1000) + 1
      await sleep(Math.min(waitMs, 5000))
    }
  }
}

export function createBackfillQuotaBucket(): GmailQuotaTokenBucket {
  return new GmailQuotaTokenBucket(
    GMAIL_BACKFILL_QUOTA_UNITS_PER_SEC,
    GMAIL_BACKFILL_QUOTA_UNITS_PER_SEC,
  )
}
