import {
  ONBOARDING_PROFILE_INDEX_AUTOPROCEED,
  ONBOARDING_PROFILE_INDEX_MANUAL_MIN,
} from '../../../server/lib/onboardingProfileThresholds.js'

export type OnboardingMailStatus = {
  configured: boolean
  indexedTotal: number | null
  lastSyncedAt: string | null
  dateRange: { from: string | null; to: string | null }
  syncRunning: boolean
  syncLockAgeMs: number | null
  ftsReady: number | null
  /** Ripmail still has mail to pull; sync is idle — good time to kick `refresh`. */
  pendingBackfill?: boolean
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
    syncLockAgeMs: null,
    ftsReady: null,
    pendingBackfill: false,
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

export const ONBOARDING_LARGE_WINDOW_STATES = new Set([
  'profiling',
  'reviewing-profile',
  'done',
])
