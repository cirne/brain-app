import { describe, expect, it } from 'vitest'
import { POLICY_ALWAYS_OMIT } from './brainQueryAnswerBaseline.js'

describe('POLICY_ALWAYS_OMIT', () => {
  it('is non-empty baseline copy for filter and UI', () => {
    expect(POLICY_ALWAYS_OMIT.length).toBeGreaterThan(120)
    expect(POLICY_ALWAYS_OMIT).toContain('BASELINE')
    expect(POLICY_ALWAYS_OMIT).toContain('CREDENTIALS AND ACCOUNT ACCESS')
    expect(POLICY_ALWAYS_OMIT).toMatch(/MFA|one-time/i)
  })
})
