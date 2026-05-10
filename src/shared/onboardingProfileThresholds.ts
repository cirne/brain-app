/** Minimum indexed messages before advancing to guided setup (PATCH /state → onboarding-agent and client auto-advance). */
export const ONBOARDING_PROFILE_INDEX_MANUAL_MIN = 500

/** Same threshold: client auto-advances when reached (no separate “wait for 1000” step). */
export const ONBOARDING_PROFILE_INDEX_AUTOPROCEED = ONBOARDING_PROFILE_INDEX_MANUAL_MIN

/** Auto-start Your Wiki supervisor when indexed mail reaches this (polls + finalize hook); not gated on onboarding `done`. */
export const WIKI_BUILDOUT_MIN_MESSAGES = 1000

/**
 * Historical: server once rejected `indexing` → `onboarding-agent` while `backfillRunning`.
 * Interview advances on indexed threshold (or small-inbox drain) while the initial ~1y historical slice runs in the background.
 * Kept for any external docs or stale clients referencing the string.
 */
export const ONBOARDING_BACKFILL_STILL_RUNNING_CODE = 'onboarding_backfill_running' as const
