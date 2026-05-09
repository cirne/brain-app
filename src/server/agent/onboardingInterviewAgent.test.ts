import { describe, expect, it } from 'vitest'
import {
  buildInterviewKickoffUserMessage,
  buildOnboardingInterviewSystemPrompt,
} from './onboardingInterviewAgent.js'

describe('buildOnboardingInterviewSystemPrompt', () => {
  it('includes identity-first mail recon, calendar default step, and defers inbox rules', () => {
    const s = buildOnboardingInterviewSystemPrompt('UTC', '{}')
    expect(s).not.toContain('## Assistant name')
    expect(s).toContain('list_calendars')
    expect(s).not.toContain('inbox_rules')
    expect(s).toMatch(/Inbox rules.*out of scope/i)
    expect(s).toContain('googleCalendar')
    expect(s).toContain('default_calendar_ids')
    expect(s).toContain('Do **not** ask the user to name you')
    expect(s).toContain('**Do not** ask them to name the assistant')
    expect(s).toMatch(/Warm, short, human/)
    expect(s).toContain('## Mail recon (before your first user-visible reply)')
    expect(s).toContain('**`search_index`**')
    expect(s).toContain('**`from`**')
    expect(s).toContain('**`read_mail_message`** on several sent messages')
    expect(s).toContain('**finish_conversation**')
    expect(s).toContain('suggest_reply_options')
    expect(s).toMatch(/Phase 1|step numbers|checklist voice/i)
    expect(s).not.toContain('## Important people')
    expect(s).toContain('## After that: default Google calendar (before closing)')
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
