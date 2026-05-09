import { describe, it, expect } from 'vitest'
import {
  DEDICATED_ONBOARDING_STATES,
  needsDedicatedOnboardingSurface,
} from './onboardingShellPolicy.js'

describe('onboardingShellPolicy', () => {
  it('lists pre-chat onboarding states', () => {
    expect(DEDICATED_ONBOARDING_STATES).toEqual(['not-started', 'confirming-handle', 'indexing'])
  })

  it('needs dedicated surface only for pre-chat states', () => {
    expect(needsDedicatedOnboardingSurface('not-started')).toBe(true)
    expect(needsDedicatedOnboardingSurface('confirming-handle')).toBe(true)
    expect(needsDedicatedOnboardingSurface('indexing')).toBe(true)
    expect(needsDedicatedOnboardingSurface('onboarding-agent')).toBe(false)
    expect(needsDedicatedOnboardingSurface('done')).toBe(false)
    expect(needsDedicatedOnboardingSurface('unknown')).toBe(false)
  })
})
