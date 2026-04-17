/** Client shape for `/api/onboarding/mail` (mirrors server payload fields we use). */
export type OnboardingMailStatus = {
  configured: boolean
  indexedTotal: number | null
  lastSyncedAt: string | null
  dateRange: { from: string | null; to: string | null }
  syncRunning: boolean
  syncLockAgeMs: number | null
  ftsReady: number | null
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
    indexingHint: null,
  }
}

/** Enough indexed messages for a representative profile; paired with newest-first Apple Mail sync. */
export const MIN_INDEXED_FOR_PROFILE = 1000

export const ONBOARDING_LARGE_WINDOW_STATES = new Set([
  'profiling',
  'reviewing-profile',
  'seeding',
  'done',
])
