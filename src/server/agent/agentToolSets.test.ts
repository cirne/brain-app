import { describe, expect, it } from 'vitest'
import { ONBOARDING_INTERVIEW_ONLY } from './agentToolSets.js'

describe('ONBOARDING_INTERVIEW_ONLY', () => {
  it('includes finish_conversation for same client hook as main assistant', () => {
    expect(ONBOARDING_INTERVIEW_ONLY).toContain('finish_conversation')
  })
})
