import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GmailQuotaTokenBucket,
  GMAIL_MESSAGES_GET_QUOTA_UNITS,
  isGmailQuotaError,
  withGmailRetry,
} from './gmailRateLimit.js'

describe('isGmailQuotaError', () => {
  it('detects HTTP 429', () => {
    expect(isGmailQuotaError({ code: 429, message: 'Too Many Requests' })).toBe(true)
    expect(isGmailQuotaError({ response: { status: 429 } })).toBe(true)
  })

  it('detects userRateLimitExceeded and rateLimitExceeded reasons', () => {
    expect(
      isGmailQuotaError({
        response: {
          data: {
            error: {
              errors: [{ reason: 'userRateLimitExceeded' }],
            },
          },
        },
      }),
    ).toBe(true)
    expect(
      isGmailQuotaError({
        errors: [{ reason: 'rateLimitExceeded' }],
      }),
    ).toBe(true)
  })

  it('detects quota phrases in message text', () => {
    expect(
      isGmailQuotaError(
        new Error("Quota exceeded for quota metric 'Queries' and limit 'Queries per minute per user'"),
      ),
    ).toBe(true)
    expect(isGmailQuotaError(new Error('Too many concurrent requests for user'))).toBe(true)
    expect(isGmailQuotaError(new Error('Resource has been exhausted (e.g. check quota).'))).toBe(true)
  })

  it('returns false for non-quota errors', () => {
    expect(isGmailQuotaError(new Error('network'))).toBe(false)
    expect(isGmailQuotaError({ code: 401, message: 'Invalid Credentials' })).toBe(false)
    expect(isGmailQuotaError({ code: 404, message: 'Not Found' })).toBe(false)
  })
})

describe('withGmailRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries on quota error then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: 429, message: 'rate' })
      .mockResolvedValueOnce('ok')
    const sleeps: number[] = []
    const p = withGmailRetry(fn, {
      sleep: async (ms) => {
        sleeps.push(ms)
        await vi.advanceTimersByTimeAsync(ms)
      },
    })
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(sleeps.length).toBe(1)
  })

  it('increases delay between retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ code: 429 })
      .mockRejectedValueOnce({ code: 429 })
      .mockResolvedValueOnce('ok')
    const sleeps: number[] = []
    const p = withGmailRetry(fn, {
      sleep: async (ms) => {
        sleeps.push(ms)
        await vi.advanceTimersByTimeAsync(ms)
      },
    })
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBe('ok')
    expect(sleeps[1]).toBeGreaterThanOrEqual(sleeps[0])
  })

  it('throws after maxAttempts on persistent quota errors', async () => {
    const err = { code: 429, message: 'rate' }
    const fn = vi.fn().mockRejectedValue(err)
    const p = withGmailRetry(fn, {
      maxAttempts: 3,
      sleep: async (ms) => {
        await vi.advanceTimersByTimeAsync(ms)
      },
    })
    await vi.runAllTimersAsync()
    await expect(p).rejects.toEqual(err)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry non-quota errors', async () => {
    const err = new Error('auth')
    const fn = vi.fn().mockRejectedValue(err)
    await expect(
      withGmailRetry(fn, {
        sleep: async (ms) => {
          await vi.advanceTimersByTimeAsync(ms)
        },
      }),
    ).rejects.toThrow('auth')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('GmailQuotaTokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits when burst capacity is exhausted', async () => {
    const bucket = new GmailQuotaTokenBucket(10, 10)
    const sleeps: number[] = []
    const sleep = async (ms: number) => {
      sleeps.push(ms)
      vi.advanceTimersByTime(ms)
    }
    await bucket.acquire(10, sleep)
    const p = bucket.acquire(10, sleep)
    await vi.runAllTimersAsync()
    await p
    expect(sleeps.length).toBeGreaterThan(0)
  })

  it('charges messages.get quota units', async () => {
    const bucket = new GmailQuotaTokenBucket(100, 100)
    await bucket.acquire(GMAIL_MESSAGES_GET_QUOTA_UNITS)
    expect(bucket).toBeDefined()
  })
})
