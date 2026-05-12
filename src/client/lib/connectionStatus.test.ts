import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import {
  connectionStatus,
  notifyConnected,
  notifyPossibleConnectionIssue,
  resetConnectionStatusForTests,
  runVaultProbe,
} from './connectionStatus.js'

describe('connectionStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    resetConnectionStatusForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sets session-expired when probe returns unlocked false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ unlocked: false }), { status: 200 }),
    )
    await runVaultProbe()
    expect(get(connectionStatus)).toBe('session-expired')
  })

  it('stays connected when probe returns unlocked true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ unlocked: true }), { status: 200 }),
    )
    await runVaultProbe()
    expect(get(connectionStatus)).toBe('connected')
  })

  it('sets server-unavailable when probe network fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    await runVaultProbe()
    expect(get(connectionStatus)).toBe('server-unavailable')
  })

  it('sets server-unavailable when probe HTTP not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }))
    await runVaultProbe()
    expect(get(connectionStatus)).toBe('server-unavailable')
  })

  it('debounces notifyPossibleConnectionIssue into one probe', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ unlocked: true }), { status: 200 }),
    )
    notifyPossibleConnectionIssue()
    notifyPossibleConnectionIssue()
    notifyPossibleConnectionIssue()
    await vi.advanceTimersByTimeAsync(399)
    expect(fetchSpy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.runAllTimersAsync()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('notifyConnected clears server-unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    await runVaultProbe()
    expect(get(connectionStatus)).toBe('server-unavailable')
    notifyConnected()
    expect(get(connectionStatus)).toBe('connected')
  })

  it('recurring probe clears server-unavailable when vault responds', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(
        new Response(JSON.stringify({ unlocked: true }), { status: 200 }),
      )
    await runVaultProbe()
    expect(get(connectionStatus)).toBe('server-unavailable')
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.runOnlyPendingTimersAsync()
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(get(connectionStatus)).toBe('connected')
  })
})
