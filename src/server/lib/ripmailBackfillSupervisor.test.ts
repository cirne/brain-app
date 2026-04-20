import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as onboardingMailStatus from './onboardingMailStatus.js'
import * as syncAll from './syncAll.js'
import { startRipmailBackfillSupervisor, stopRipmailBackfillSupervisor } from './ripmailBackfillSupervisor.js'

describe('ripmailBackfillSupervisor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopRipmailBackfillSupervisor()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('kicks refresh when pending backfill and idle', async () => {
    const syncSpy = vi.spyOn(syncAll, 'syncInboxRipmail').mockResolvedValue({ ok: true })
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue({
      configured: true,
      indexedTotal: 100,
      lastSyncedAt: null,
      dateRange: { from: null, to: null },
      syncRunning: false,
      syncLockAgeMs: null,
      ftsReady: 100,
      pendingBackfill: true,
      staleMailSyncLock: false,
    })

    startRipmailBackfillSupervisor()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(syncSpy).toHaveBeenCalledTimes(1)
  })

  it('does not kick when sync is running', async () => {
    const syncSpy = vi.spyOn(syncAll, 'syncInboxRipmail').mockResolvedValue({ ok: true })
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue({
      configured: true,
      indexedTotal: 100,
      lastSyncedAt: null,
      dateRange: { from: null, to: null },
      syncRunning: true,
      syncLockAgeMs: 5000,
      ftsReady: 100,
      pendingBackfill: false,
      staleMailSyncLock: false,
    })

    startRipmailBackfillSupervisor()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(syncSpy).not.toHaveBeenCalled()
  })
})
