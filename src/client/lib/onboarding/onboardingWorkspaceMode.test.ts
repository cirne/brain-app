import { describe, expect, it } from 'vitest'
import {
  onboardingHidesComposerForActivityFlow,
  onboardingInterviewUsesMainChatUi,
} from './onboardingWorkspaceMode.js'

describe('onboardingWorkspaceMode', () => {
  it('uses assistant-style transcript + composer only for the guided interview', () => {
    expect(onboardingInterviewUsesMainChatUi('/api/onboarding/interview')).toBe(true)
    expect(onboardingInterviewUsesMainChatUi('/api/onboarding/profile')).toBe(false)
    expect(onboardingInterviewUsesMainChatUi('/api/onboarding/seed')).toBe(false)
  })

  it('hides composer only for profiling and seeding', () => {
    expect(onboardingHidesComposerForActivityFlow('/api/onboarding/interview')).toBe(false)
    expect(onboardingHidesComposerForActivityFlow('/api/onboarding/profile')).toBe(true)
    expect(onboardingHidesComposerForActivityFlow('/api/onboarding/seed')).toBe(true)
  })
})
