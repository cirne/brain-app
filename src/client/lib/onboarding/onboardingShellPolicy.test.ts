import { describe, it, expect } from 'vitest'
import {
  DEDICATED_ONBOARDING_STATES,
  needsDedicatedOnboardingSurface,
  shouldAutoKickInitialBootstrap,
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

  it('auto initial-bootstrap kickoff only before server binds bootstrap session id', () => {
    expect(shouldAutoKickInitialBootstrap(null)).toBe(true)
    expect(shouldAutoKickInitialBootstrap('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
  })
})
