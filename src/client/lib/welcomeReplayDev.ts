/** DEV: `/welcome?replay-onboarding=1` — opt-in soft reset before showing onboarding again (see App.svelte). */
export function isReplayOnboardingWelcomeSearch(search: string): boolean {
  const raw = search.startsWith('?') ? search.slice(1) : search
  return new URLSearchParams(raw).get('replay-onboarding') === '1'
}
