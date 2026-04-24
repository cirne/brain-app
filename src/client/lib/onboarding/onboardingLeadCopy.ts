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
    'Your wiki lives in your vault on this Mac—private to this device, not uploaded, and not available on the web. We use mail stored here to draft a short profile into your local notes.',
}

/** Hosted multi-tenant: emphasize what we’re doing (no “this Mac” local-vault framing). */
export const profilingLeadCopyMultiTenant: OnboardingLeadBlock = {
  title: 'Building your profile',
  lead:
    "We're building your profile by learning from your emails. This will take a few moments.",
}

export const wikiBuildoutLeadCopy: OnboardingLeadBlock = {
  title: 'Setting up your wiki',
  lead:
    "We're creating pages from your profile and mail. Your wiki stays in your vault on this Mac only—not uploaded and not reachable from elsewhere.",
}

/** Hosted multi-tenant: no local-Mac / device-only privacy framing. */
export const wikiBuildoutLeadCopyMultiTenant: OnboardingLeadBlock = {
  title: 'Setting up your wiki',
  lead:
    "We're creating pages from your profile and mail. Your wiki lives in your vault so the assistant can stay aligned with you.",
}
