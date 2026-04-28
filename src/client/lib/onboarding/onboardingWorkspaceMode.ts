/**
 * OnboardingWorkspace chat UX: OPP-054 interview uses the same shell as the main assistant
 * (transcript + composer + suggest_reply_options chips). Profiling and wiki seed stay
 * activity-style with the composer hidden.
 */
export function onboardingInterviewUsesMainChatUi(chatEndpoint: string): boolean {
  return chatEndpoint === '/api/onboarding/interview'
}

export function onboardingHidesComposerForActivityFlow(chatEndpoint: string): boolean {
  return (
    chatEndpoint === '/api/onboarding/seed' || chatEndpoint === '/api/onboarding/profile'
  )
}
