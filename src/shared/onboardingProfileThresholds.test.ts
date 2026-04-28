import { describe, it, expect } from 'vitest'
import {
  ONBOARDING_PROFILE_INDEX_AUTOPROCEED,
  ONBOARDING_PROFILE_INDEX_MANUAL_MIN,
} from './onboardingProfileThresholds.js'

describe('onboardingProfileThresholds', () => {
  it('uses one threshold for server gate, manual early continue, and client auto-advance', () => {
    expect(ONBOARDING_PROFILE_INDEX_AUTOPROCEED).toBe(ONBOARDING_PROFILE_INDEX_MANUAL_MIN)
    expect(ONBOARDING_PROFILE_INDEX_MANUAL_MIN).toBe(200)
  })
})
