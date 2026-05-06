/** Minimum indexed messages before advancing to guided setup (PATCH /state → onboarding-agent and client auto-advance). */
export const ONBOARDING_PROFILE_INDEX_MANUAL_MIN = 200

/** Same threshold: client auto-advances when reached (no separate “wait for 1000” step). */
export const ONBOARDING_PROFILE_INDEX_AUTOPROCEED = ONBOARDING_PROFILE_INDEX_MANUAL_MIN

/**
 * PATCH `/api/onboarding/state` includes this JSON `code` when rejecting `indexing` → `onboarding-agent`
 * because ripmail’s backfill lane is still active (e.g. first ~30d download).
 */
export const ONBOARDING_BACKFILL_STILL_RUNNING_CODE = 'onboarding_backfill_running' as const
