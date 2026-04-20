/**
 * Onboarding transcript headers: emphasize that the personal wiki is local to this Mac,
 * not a cloud sync or remotely accessible service. Intentionally avoids LLM/provider
 * detail; goal is to reassure non-technical users about where their notes live.
 */
export type OnboardingLeadBlock = {
  title: string
  lead: string
}

export const profilingLeadCopy: OnboardingLeadBlock = {
  title: 'Building your profile',
  lead:
    'Your personal wiki stays on this Mac—private to this device, not uploaded, and not available on the web. We use mail stored here to draft a short profile into your local notes.',
}

export const wikiBuildoutLeadCopy: OnboardingLeadBlock = {
  title: 'Setting up your wiki',
  lead:
    "We're creating pages from your profile and mail. Your wiki stays on this Mac only—not uploaded and not reachable from elsewhere.",
}
