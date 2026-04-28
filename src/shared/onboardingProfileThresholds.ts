/** Minimum indexed messages before advancing to guided setup (PATCH /state → onboarding-agent and client auto-advance). */
export const ONBOARDING_PROFILE_INDEX_MANUAL_MIN = 200

/** Same threshold: client auto-advances when reached (no separate “wait for 1000” step). */
export const ONBOARDING_PROFILE_INDEX_AUTOPROCEED = ONBOARDING_PROFILE_INDEX_MANUAL_MIN
