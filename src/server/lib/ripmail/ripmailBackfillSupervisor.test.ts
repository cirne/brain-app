import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as onboardingMailStatus from '@server/lib/onboarding/onboardingMailStatus.js'
import * as syncAll from '@server/lib/platform/syncAll.js'
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
      refreshRunning: false,
      backfillRunning: false,
      syncLockAgeMs: null,
      ftsReady: 100,
      messageAvailableForProgress: null,
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
      refreshRunning: true,
      backfillRunning: false,
      syncLockAgeMs: 5000,
      ftsReady: 100,
      messageAvailableForProgress: null,
      pendingBackfill: false,
      staleMailSyncLock: false,
    })

    startRipmailBackfillSupervisor()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(syncSpy).not.toHaveBeenCalled()
  })
})
