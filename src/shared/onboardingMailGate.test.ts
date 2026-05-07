import { describe, it, expect } from 'vitest'
import {
  canAdvanceToOnboardingAgent,
  isOnboardingInitialMailSyncComplete,
  type OnboardingMailGateInput,
} from './onboardingMailGate.js'
import { ONBOARDING_PROFILE_INDEX_MANUAL_MIN } from './onboardingProfileThresholds.js'

function baseMail(overrides: Partial<OnboardingMailGateInput> = {}): OnboardingMailGateInput {
  return {
    configured: true,
    syncRunning: false,
    refreshRunning: false,
    backfillRunning: false,
    pendingBackfill: false,
    staleMailSyncLock: false,
    lastSyncedAt: '2026-05-07T12:00:00.000Z',
    indexingHint: null,
    ...overrides,
  }
}

describe('isOnboardingInitialMailSyncComplete', () => {
  it('is true when small-inbox initial sync has finished and nothing is pending', () => {
    expect(isOnboardingInitialMailSyncComplete(baseMail())).toBe(true)
  })

  it('is false before mail is configured', () => {
    expect(
      isOnboardingInitialMailSyncComplete(baseMail({ configured: false, lastSyncedAt: null })),
    ).toBe(false)
  })

  it('is false when no sync has completed yet (lastSyncedAt null)', () => {
    expect(isOnboardingInitialMailSyncComplete(baseMail({ lastSyncedAt: null }))).toBe(false)
  })

  it('is false while any lane is still running', () => {
    expect(isOnboardingInitialMailSyncComplete(baseMail({ syncRunning: true }))).toBe(false)
    expect(isOnboardingInitialMailSyncComplete(baseMail({ backfillRunning: true }))).toBe(false)
    expect(isOnboardingInitialMailSyncComplete(baseMail({ refreshRunning: true }))).toBe(false)
  })

  it('is false when a mailbox still reports needsBackfill', () => {
    expect(isOnboardingInitialMailSyncComplete(baseMail({ pendingBackfill: true }))).toBe(false)
  })

  it('is false on stale DB lock', () => {
    expect(isOnboardingInitialMailSyncComplete(baseMail({ staleMailSyncLock: true }))).toBe(false)
  })

  it('is false when an actionable hint is present (e.g. hang suspected)', () => {
    expect(
      isOnboardingInitialMailSyncComplete(
        baseMail({ indexingHint: 'A previous mail sync stopped unexpectedly.' }),
      ),
    ).toBe(false)
  })
})

describe('canAdvanceToOnboardingAgent', () => {
  it('advances when indexed count meets the threshold even if sync still running', () => {
    expect(
      canAdvanceToOnboardingAgent(
        ONBOARDING_PROFILE_INDEX_MANUAL_MIN,
        baseMail({ backfillRunning: true, lastSyncedAt: null }),
      ),
    ).toBe(true)
  })

  it('advances on small-inbox completion below the threshold', () => {
    expect(canAdvanceToOnboardingAgent(37, baseMail())).toBe(true)
  })

  it('blocks when below threshold and sync is still pending', () => {
    expect(canAdvanceToOnboardingAgent(37, baseMail({ pendingBackfill: true }))).toBe(false)
    expect(canAdvanceToOnboardingAgent(37, baseMail({ backfillRunning: true }))).toBe(false)
    expect(canAdvanceToOnboardingAgent(0, baseMail({ lastSyncedAt: null }))).toBe(false)
  })

  it('blocks when an actionable hint blocks completion', () => {
    expect(
      canAdvanceToOnboardingAgent(
        37,
        baseMail({ indexingHint: 'This is taking longer than usual.' }),
      ),
    ).toBe(false)
  })
})
