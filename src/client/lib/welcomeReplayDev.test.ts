import { describe, it, expect } from 'vitest'
import { isReplayOnboardingWelcomeSearch } from './welcomeReplayDev.js'

describe('welcomeReplayDev', () => {
  it('detects replay-onboarding=1', () => {
    expect(isReplayOnboardingWelcomeSearch('?replay-onboarding=1')).toBe(true)
    expect(isReplayOnboardingWelcomeSearch('replay-onboarding=1')).toBe(true)
    expect(isReplayOnboardingWelcomeSearch('?replay-onboarding=0')).toBe(false)
    expect(isReplayOnboardingWelcomeSearch('')).toBe(false)
    expect(isReplayOnboardingWelcomeSearch('?other=1')).toBe(false)
  })
})
