import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __syncCoordinatorStateForTests,
  cancelPendingDebouncedWikiSync,
  onWikiMutatedForAutoSync,
  registerDebouncedWikiSyncRunner,
  resetWikiSyncCoordinatorForTests,
  runSyncOrQueueFollowUp,
  scheduleDebouncedSyncAfterWikiChange,
} from './debouncedWikiSync.js'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('debouncedWikiSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetWikiSyncCoordinatorForTests()
    vi.useRealTimers()
  })

  it('runs registered sync after debounce', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    registerDebouncedWikiSyncRunner(fn)
    scheduleDebouncedSyncAfterWikiChange(1000)
    expect(fn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('resets timer when scheduled again', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    registerDebouncedWikiSyncRunner(fn)
    scheduleDebouncedSyncAfterWikiChange(1000)
    await vi.advanceTimersByTimeAsync(400)
    scheduleDebouncedSyncAfterWikiChange(1000)
    await vi.advanceTimersByTimeAsync(400)
    expect(fn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(600)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancelPendingDebouncedWikiSync prevents debounced run', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    registerDebouncedWikiSyncRunner(fn)
    scheduleDebouncedSyncAfterWikiChange(500)
    await vi.advanceTimersByTimeAsync(200)
    cancelPendingDebouncedWikiSync()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('does not overlap two sync runs; second call queues one follow-up', async () => {
    const d1 = deferred()
    const fn = vi.fn().mockImplementation(() => d1.promise)
    registerDebouncedWikiSyncRunner(fn)

    const p1 = runSyncOrQueueFollowUp()
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(__syncCoordinatorStateForTests().inFlight).toBe(true)

    void runSyncOrQueueFollowUp()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(__syncCoordinatorStateForTests().pendingFollowUp).toBe(true)

    d1.resolve()
    await p1
    await vi.advanceTimersByTimeAsync(0)

    expect(fn).toHaveBeenCalledTimes(2)
    expect(__syncCoordinatorStateForTests().pendingFollowUp).toBe(false)
    expect(__syncCoordinatorStateForTests().inFlight).toBe(false)
  })

  it('coalesces multiple queue requests during one run into a single follow-up', async () => {
    const d1 = deferred()
    const fn = vi.fn().mockImplementation(() => d1.promise)
    registerDebouncedWikiSyncRunner(fn)

    void runSyncOrQueueFollowUp()
    await vi.advanceTimersByTimeAsync(0)
    void runSyncOrQueueFollowUp()
    void runSyncOrQueueFollowUp()
    void runSyncOrQueueFollowUp()
    expect(fn).toHaveBeenCalledTimes(1)

    d1.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('debounce fires while sync in flight: queues follow-up, no concurrent run', async () => {
    const d1 = deferred()
    const fn = vi.fn().mockImplementation(() => d1.promise)
    registerDebouncedWikiSyncRunner(fn)

    scheduleDebouncedSyncAfterWikiChange(2000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    scheduleDebouncedSyncAfterWikiChange(2000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fn).toHaveBeenCalledTimes(1)

    d1.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('onWikiMutatedForAutoSync while idle starts debounce only', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    registerDebouncedWikiSyncRunner(fn)
    onWikiMutatedForAutoSync(500)
    expect(__syncCoordinatorStateForTests().hasDebouncedTimer).toBe(true)
    await vi.advanceTimersByTimeAsync(500)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('onWikiMutatedForAutoSync while in flight sets follow-up without new debounce timer', async () => {
    const d1 = deferred()
    const fn = vi.fn().mockImplementation(() => d1.promise)
    registerDebouncedWikiSyncRunner(fn)

    void runSyncOrQueueFollowUp()
    await vi.advanceTimersByTimeAsync(0)
    onWikiMutatedForAutoSync(2000)
    expect(__syncCoordinatorStateForTests().pendingFollowUp).toBe(true)
    expect(__syncCoordinatorStateForTests().hasDebouncedTimer).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(fn).toHaveBeenCalledTimes(1)

    d1.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('chains multiple follow-ups when changes keep landing during consecutive runs', async () => {
    const phases = [deferred(), deferred(), deferred()]
    let i = 0
    const fn = vi.fn().mockImplementation(() => phases[i++]!.promise)
    registerDebouncedWikiSyncRunner(fn)

    void runSyncOrQueueFollowUp()
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(1)

    void runSyncOrQueueFollowUp()
    phases[0]!.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(2)

    void runSyncOrQueueFollowUp()
    phases[1]!.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(3)

    phases[2]!.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(3)
    expect(__syncCoordinatorStateForTests().inFlight).toBe(false)
  })

  it('clears pending debounce when starting idle wiki mutation path', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    registerDebouncedWikiSyncRunner(fn)
    onWikiMutatedForAutoSync(1000)
    onWikiMutatedForAutoSync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('re-registering runner while idle updates the next sync', async () => {
    const a = vi.fn().mockResolvedValue(undefined)
    const b = vi.fn().mockResolvedValue(undefined)
    registerDebouncedWikiSyncRunner(a)
    await runSyncOrQueueFollowUp()
    await vi.advanceTimersByTimeAsync(0)
    expect(a).toHaveBeenCalledTimes(1)

    registerDebouncedWikiSyncRunner(b)
    await runSyncOrQueueFollowUp()
    await vi.advanceTimersByTimeAsync(0)
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledTimes(1)
  })

  it('follow-up still runs when first run throws (finally chains)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined)
    registerDebouncedWikiSyncRunner(fn)

    const p1 = runSyncOrQueueFollowUp()
    void runSyncOrQueueFollowUp()
    await expect(p1).rejects.toThrow('boom')
    await vi.advanceTimersByTimeAsync(0)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
