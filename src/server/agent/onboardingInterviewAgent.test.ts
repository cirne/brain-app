import { describe, expect, it } from 'vitest'
import {
  buildInterviewKickoffUserMessage,
  buildOnboardingInterviewSystemPrompt,
} from './onboardingInterviewAgent.js'

describe('buildOnboardingInterviewSystemPrompt', () => {
  it('leans identity + people; no assistant naming, calendar, or inbox in flow', () => {
    const s = buildOnboardingInterviewSystemPrompt('UTC', '{}')
    expect(s).not.toContain('## Assistant name')
    expect(s).not.toContain('list_calendars')
    expect(s).not.toContain('inbox_rules')
    expect(s).toContain('out of scope here')
    expect(s).toContain('Calendar and inbox rules')
    expect(s).toContain('Do **not** ask the user to name you')
    expect(s).toContain('**Do not** ask them to name the assistant')
    expect(s).toContain('## Mail recon (before identity with the user)')
    expect(s).toContain('**`search_index`**')
    expect(s).toContain('**`from`**')
    expect(s).toContain('**`read_email`** on **2–4**')
    expect(s).toContain('**finish_conversation**')
    expect(s).toContain('suggest_reply_options')
    expect(s).toMatch(/Phase 1|step numbers|checklist voice/i)
    expect(s).toContain('**Forbidden:** frequency filler')
    expect(s).toContain('until **`read_email`** has returned')
  })
})

describe('buildInterviewKickoffUserMessage', () => {
  it('embeds whoami and instructions', () => {
    const s = buildInterviewKickoffUserMessage(
      '{"mailboxes":[{"inferred":{"primaryEmail":"a@b.com"}}]}',
      'Start with identity confirmation.',
    )
    expect(s).toContain('ripmail whoami')
    expect(s).toContain('a@b.com')
    expect(s).toContain('Start with identity confirmation.')
    expect(s).toContain('source of truth')
  })

  it('uses placeholder when whoami is empty', () => {
    const s = buildInterviewKickoffUserMessage('', 'Go.')
    expect(s).toContain('ripmail whoami produced no output')
    expect(s).toContain('Go.')
  })
})
