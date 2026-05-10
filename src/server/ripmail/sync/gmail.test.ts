import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  GMAIL_MESSAGES_GET_CONCURRENCY,
  historicalSinceToAfterEpochSeconds,
  runWithConcurrencyPool,
} from './gmail.js'

describe('historicalSinceToAfterEpochSeconds', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('computes epoch seconds N days before now for hub tokens', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    expect(historicalSinceToAfterEpochSeconds('30d')).toBe(nowSec - 30 * 86_400)
    expect(historicalSinceToAfterEpochSeconds('1y')).toBe(nowSec - 365 * 86_400)
    expect(historicalSinceToAfterEpochSeconds('2y')).toBe(nowSec - 2 * 365 * 86_400)
  })

  it('rejects unknown specs', () => {
    expect(() => historicalSinceToAfterEpochSeconds('bogus')).toThrow(/invalid historicalSince/)
  })
})

describe('runWithConcurrencyPool', () => {
  it(`never exceeds the concurrency limit (${GMAIL_MESSAGES_GET_CONCURRENCY}) while work is in flight`, async () => {
    let inFlight = 0
    let maxInFlight = 0
    const n = 24
    await runWithConcurrencyPool(
      Array.from({ length: n }, (_, i) => i),
      GMAIL_MESSAGES_GET_CONCURRENCY,
      async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise<void>((resolve) => {
          queueMicrotask(resolve)
        })
        inFlight--
      },
    )
    expect(maxInFlight).toBe(GMAIL_MESSAGES_GET_CONCURRENCY)
    expect(inFlight).toBe(0)
  })

  it('runs all items when count is below the limit', async () => {
    const seen: number[] = []
    await runWithConcurrencyPool([1, 2, 3], GMAIL_MESSAGES_GET_CONCURRENCY, async (x) => {
      seen.push(x)
      return x
    })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3])
  })
})
