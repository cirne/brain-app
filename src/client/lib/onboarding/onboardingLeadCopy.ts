import { get } from 'svelte/store'
import { t } from '@client/lib/i18n/index.js'

/**
 * Onboarding transcript headers: emphasize that the personal wiki is local to this Mac,
 * not a cloud sync or remotely accessible service. Intentionally avoids LLM/provider
 * detail; goal is to reassure non-technical users about where their notes live.
 */
export type OnboardingLeadBlock = {
  title: string
  lead: string
}

function onboardingText(key: string, defaultValue: string): string {
  return get(t)(`onboarding.${key}`, defaultValue)
}

function createLeadBlock(
  titleKey: string,
  titleDefault: string,
  leadKey: string,
  leadDefault: string,
): OnboardingLeadBlock {
  return {
    get title() {
      return onboardingText(titleKey, titleDefault)
    },
    get lead() {
      return onboardingText(leadKey, leadDefault)
    },
  }
}

export const profilingLeadCopy: OnboardingLeadBlock = createLeadBlock(
  'profiling.title',
  'Building your profile',
  'profiling.leadDesktop',
  'Your wiki lives in your vault on this Mac—private to this device, not uploaded, and not available on the web. We use mail stored here to draft a short profile into your local notes.',
)

/** Hosted multi-tenant: no local-Mac / device-only privacy framing. */
export const profilingLeadCopyMultiTenant: OnboardingLeadBlock = createLeadBlock(
  'profiling.title',
  'Building your profile',
  'profiling.leadHosted',
  "We're building your profile by learning from your emails. This will take a few moments.",
)

export const wikiBuildoutLeadCopy: OnboardingLeadBlock = createLeadBlock(
  'wikiBuildout.title',
  'Setting up your wiki',
  'wikiBuildout.leadDesktop',
  "We're creating pages from your profile and mail. Your wiki stays in your vault on this Mac only—not uploaded and not reachable from elsewhere.",
)

/** Hosted multi-tenant: no local-Mac / device-only privacy framing. */
export const wikiBuildoutLeadCopyMultiTenant: OnboardingLeadBlock = createLeadBlock(
  'wikiBuildout.title',
  'Setting up your wiki',
  'wikiBuildout.leadHosted',
  "We're creating pages from your profile and mail. Your wiki lives in your vault so the assistant can stay aligned with you.",
)
