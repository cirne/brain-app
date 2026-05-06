import { describe, it, expect } from 'vitest'
import { onboardingMailStatusFromBackground } from './backgroundStatusMap.js'

describe('onboardingMailStatusFromBackground', () => {
  it('maps unified mail slice to OnboardingMailStatus', () => {
    const m = onboardingMailStatusFromBackground({
      indexedTotal: 42,
      ftsReady: 40,
      messageAvailableForProgress: 100,
      configured: true,
      dateRange: { from: 'a', to: 'b' },
      phase1Complete: true,
      phase2Complete: false,
      syncRunning: false,
      backfillRunning: false,
      backfillPhase: null,
      refreshRunning: false,
      lastSyncedAt: null,
      syncLockAgeMs: null,
      pendingBackfill: false,
      staleMailSyncLock: false,
    })
    expect(m.indexedTotal).toBe(42)
    expect(m.ftsReady).toBe(40)
    expect(m.messageAvailableForProgress).toBe(100)
    expect(m.dateRange).toEqual({ from: 'a', to: 'b' })
  })
})
