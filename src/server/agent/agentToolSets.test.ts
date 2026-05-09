import { describe, expect, it } from 'vitest'
import { ONBOARDING_INTERVIEW_ONLY } from './agentToolSets.js'

describe('ONBOARDING_INTERVIEW_ONLY', () => {
  it('includes finish_conversation for same client hook as main assistant', () => {
    expect(ONBOARDING_INTERVIEW_ONLY).toContain('finish_conversation')
  })

  it('includes wiki navigation + incremental profile edits during interview', () => {
    expect(ONBOARDING_INTERVIEW_ONLY).toEqual(
      expect.arrayContaining(['read', 'write', 'edit', 'grep', 'find']),
    )
  })

  it('includes calendar for default-calendar setup; still omits inbox tools', () => {
    expect(ONBOARDING_INTERVIEW_ONLY).toContain('calendar')
    expect(ONBOARDING_INTERVIEW_ONLY).not.toContain('inbox_rules')
    expect(ONBOARDING_INTERVIEW_ONLY).not.toContain('list_inbox')
  })

  it('includes web_search for onboarding bootstrap context rounding', () => {
    expect(ONBOARDING_INTERVIEW_ONLY).toContain('web_search')
  })
})
