import { describe, it, expect } from 'vitest'
import { shouldKickOnboardingInboxSync } from './onboardingInboxSyncKick.js'

describe('shouldKickOnboardingInboxSync', () => {
  it('is false when mail is not configured or already kicked', () => {
    expect(
      shouldKickOnboardingInboxSync({
        state: 'not-started',
        mailConfigured: false,
        alreadyKicked: false,
      }),
    ).toBe(false)
    expect(
      shouldKickOnboardingInboxSync({
        state: 'not-started',
        mailConfigured: true,
        alreadyKicked: true,
      }),
    ).toBe(false)
  })

  it('is true for not-started or indexing when mail is ready', () => {
    expect(
      shouldKickOnboardingInboxSync({
        state: 'not-started',
        mailConfigured: true,
        alreadyKicked: false,
      }),
    ).toBe(true)
    expect(
      shouldKickOnboardingInboxSync({
        state: 'indexing',
        mailConfigured: true,
        alreadyKicked: false,
      }),
    ).toBe(true)
  })

  it('is false for other states', () => {
    for (const state of ['onboarding-agent', 'done', 'confirming-handle']) {
      expect(
        shouldKickOnboardingInboxSync({
          state,
          mailConfigured: true,
          alreadyKicked: false,
        }),
      ).toBe(false)
    }
  })
})
