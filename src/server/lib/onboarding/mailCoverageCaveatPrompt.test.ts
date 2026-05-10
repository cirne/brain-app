import { describe, expect, it } from 'vitest'
import { buildMailCoverageCaveatForMainAssistant } from './mailCoverageCaveatPrompt.js'
import type { OnboardingMailStatusPayload } from './onboardingMailStatus.js'
import { ONBOARDING_PROFILE_INDEX_MANUAL_MIN } from '@shared/onboardingProfileThresholds.js'

function baseMail(over: Partial<OnboardingMailStatusPayload> = {}): OnboardingMailStatusPayload {
  return {
    configured: true,
    indexedTotal: 100,
    lastSyncedAt: '2026-01-01T00:00:00.000Z',
    dateRange: { from: '2020-01-01', to: '2025-12-01' },
    syncRunning: false,
    refreshRunning: false,
    backfillRunning: false,
    syncLockAgeMs: null,
    ftsReady: 100,
    messageAvailableForProgress: 500,
    pendingBackfill: false,
    deepHistoricalPending: false,
    staleMailSyncLock: false,
    indexingHint: null,
    ...over,
  }
}

describe('buildMailCoverageCaveatForMainAssistant', () => {
  it('returns null when mail is not configured', () => {
    expect(buildMailCoverageCaveatForMainAssistant(baseMail({ configured: false }))).toBeNull()
  })

  it('returns null at or above manual minimum indexed count', () => {
    expect(
      buildMailCoverageCaveatForMainAssistant(
        baseMail({ indexedTotal: ONBOARDING_PROFILE_INDEX_MANUAL_MIN, ftsReady: 0 }),
      ),
    ).toBeNull()
    expect(
      buildMailCoverageCaveatForMainAssistant(
        baseMail({ indexedTotal: 0, ftsReady: ONBOARDING_PROFILE_INDEX_MANUAL_MIN }),
      ),
    ).toBeNull()
  })

  it('returns caveat with date span when below threshold', () => {
    const s = buildMailCoverageCaveatForMainAssistant(baseMail({ indexedTotal: 120 }))
    expect(s).toContain('120')
    expect(s).toContain('2020-01-01')
    expect(s).toContain('2025-12-01')
    expect(s).toContain('do **not** imply full mailbox history')
  })

  it('mentions ongoing sync when deep historical gmail slice pending', () => {
    const s = buildMailCoverageCaveatForMainAssistant(
      baseMail({
        indexedTotal: 50,
        pendingBackfill: false,
        deepHistoricalPending: true,
      }),
    )
    expect(s).toContain('Background sync')
  })

  it('mentions ongoing sync when lanes are active', () => {
    const s = buildMailCoverageCaveatForMainAssistant(
      baseMail({ indexedTotal: 50, backfillRunning: true }),
    )
    expect(s).toContain('Background sync')
  })
})
