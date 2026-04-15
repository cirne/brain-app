/** Keys used by AgentDrawer for onboarding flows (localStorage transcript cache). */
export const ONBOARDING_DEFAULT_CHAT_STORAGE_KEY = 'brain-onboarding-chat'
export const ONBOARDING_PROFILE_CHAT_STORAGE_KEY = 'brain-onboarding-profile'
export const ONBOARDING_SEED_CHAT_STORAGE_KEY = 'brain-onboarding-seed'

const ALL_KEYS = [
  ONBOARDING_DEFAULT_CHAT_STORAGE_KEY,
  ONBOARDING_PROFILE_CHAT_STORAGE_KEY,
  ONBOARDING_SEED_CHAT_STORAGE_KEY,
] as const

/** Clear persisted onboarding agent UI state (server hard-reset does not touch localStorage). */
export function clearOnboardingAgentLocalStorage(): void {
  if (typeof localStorage === 'undefined') return
  for (const k of ALL_KEYS) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  }
}
