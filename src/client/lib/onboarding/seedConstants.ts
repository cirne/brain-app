/** Minimum wiki pages (excluding profile) before offering early exit during onboarding seeding. */
export const SEED_EARLY_EXIT_MIN_PAGES = 10

/**
 * Legacy key still cleared by `clearBrainClientStorage()`. First-chat kickoff uses
 * `GET /api/chat/first-chat-pending` + `first-chat-pending.json` under Brain home.
 */
export const FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY = 'brain-fresh-chat-after-onboarding'
