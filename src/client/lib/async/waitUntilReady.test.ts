import { describe, it, expect, vi } from 'vitest'
import { waitUntilDefinedOrMaxTicks } from './waitUntilReady.js'

describe('waitUntilDefinedOrMaxTicks', () => {
  it('returns value after tick when get() is truthy', async () => {
    const tick = vi.fn(async () => {})
    const v = await waitUntilDefinedOrMaxTicks({
      get: () => 'ok',
      tick,
      maxIterations: 16,
    })
    expect(v).toBe('ok')
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('returns undefined after max iterations', async () => {
    const tick = vi.fn(async () => {})
    const v = await waitUntilDefinedOrMaxTicks({
      get: () => undefined,
      tick,
      maxIterations: 3,
    })
    expect(v).toBeUndefined()
    expect(tick).toHaveBeenCalledTimes(3)
  })

  it('returns undefined when shouldAbort is true after tick', async () => {
    const tick = vi.fn(async () => {})
    const v = await waitUntilDefinedOrMaxTicks({
      get: () => undefined,
      tick,
      maxIterations: 10,
      shouldAbort: () => true,
    })
    expect(v).toBeUndefined()
    expect(tick).toHaveBeenCalledTimes(1)
  })
})
