import { describe, it, expect } from 'vitest'
import {
  ONBOARDING_PROFILE_INDEX_AUTOPROCEED,
  ONBOARDING_PROFILE_INDEX_MANUAL_MIN,
  WIKI_BUILDOUT_MIN_MESSAGES,
  WIKI_SUPERVISOR_MIN_INDEXED_HISTORY_DAYS,
} from './onboardingProfileThresholds.js'

describe('onboardingProfileThresholds', () => {
  it('uses one threshold for server gate, manual early continue, and client auto-advance', () => {
    expect(ONBOARDING_PROFILE_INDEX_AUTOPROCEED).toBe(ONBOARDING_PROFILE_INDEX_MANUAL_MIN)
    expect(ONBOARDING_PROFILE_INDEX_MANUAL_MIN).toBe(500)
  })

  it('defines wiki buildout gate after onboarding completes', () => {
    expect(WIKI_BUILDOUT_MIN_MESSAGES).toBe(1000)
  })

  it('defines wiki supervisor minimum indexed history depth (days)', () => {
    expect(WIKI_SUPERVISOR_MIN_INDEXED_HISTORY_DAYS).toBe(90)
  })
})
