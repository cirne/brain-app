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

  it('omits calendar and inbox tools (skills / main chat handle those)', () => {
    expect(ONBOARDING_INTERVIEW_ONLY).not.toContain('calendar')
    expect(ONBOARDING_INTERVIEW_ONLY).not.toContain('inbox_rules')
    expect(ONBOARDING_INTERVIEW_ONLY).not.toContain('list_inbox')
  })

  it('includes suggest_reply_options for composer quick replies (same as main assistant)', () => {
    expect(ONBOARDING_INTERVIEW_ONLY).toContain('suggest_reply_options')
  })
})
