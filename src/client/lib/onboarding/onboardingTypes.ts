import {
  ONBOARDING_PROFILE_INDEX_AUTOPROCEED,
  ONBOARDING_PROFILE_INDEX_MANUAL_MIN,
} from '@shared/onboardingProfileThresholds.js'

export type OnboardingMailStatus = {
  configured: boolean
  indexedTotal: number | null
  lastSyncedAt: string | null
  dateRange: { from: string | null; to: string | null }
  syncRunning: boolean
  refreshRunning: boolean
  /** True while ripmail reports the backfill lane active (`sync.backfill`). */
  backfillRunning: boolean
  syncLockAgeMs: number | null
  ftsReady: number | null
  /** Denominator for mail download progress (e.g. mailbox row count or sync target). */
  messageAvailableForProgress: number | null
  /** Gmail historical lane listed-ID target while `backfillRunning`. */
  backfillListedTarget?: number | null
  /** Ripmail still has mail to pull; sync is idle — good time to kick `refresh`. */
  pendingBackfill?: boolean
  /** Gmail extended historical sync (~1y) may still add mail while lanes look idle. */
  deepHistoricalPending?: boolean
  /** DB lock without a live process — avoid stacking refreshes. */
  staleMailSyncLock?: boolean
  /** Actionable hint from server (stale sync lock, hang suspected). */
  indexingHint?: string | null
  statusError?: string
}

export function emptyOnboardingMail(): OnboardingMailStatus {
  return {
    configured: false,
    indexedTotal: null,
    lastSyncedAt: null,
    dateRange: { from: null, to: null },
    syncRunning: false,
    refreshRunning: false,
    backfillRunning: false,
    syncLockAgeMs: null,
    ftsReady: null,
    messageAvailableForProgress: null,
    backfillListedTarget: null,
    pendingBackfill: false,
    deepHistoricalPending: false,
    staleMailSyncLock: false,
    indexingHint: null,
  }
}

export {
  ONBOARDING_PROFILE_INDEX_AUTOPROCEED,
  ONBOARDING_PROFILE_INDEX_MANUAL_MIN,
}

/** @deprecated Prefer {@link ONBOARDING_PROFILE_INDEX_AUTOPROCEED}. */
export const MIN_INDEXED_FOR_PROFILE = ONBOARDING_PROFILE_INDEX_AUTOPROCEED

export const ONBOARDING_LARGE_WINDOW_STATES = new Set(['onboarding-agent', 'done'])
