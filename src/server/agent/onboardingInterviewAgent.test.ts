import { describe, expect, it } from 'vitest'
import {
  buildInterviewKickoffUserMessage,
  buildOnboardingInterviewSystemPrompt,
} from './onboardingInterviewAgent.js'

describe('buildOnboardingInterviewSystemPrompt', () => {
  it('requires vault-root assistant.md, mail recon before naming, and explicit calendar listing', () => {
    const s = buildOnboardingInterviewSystemPrompt('UTC', '{}')
    expect(s).toContain('vault root path **`assistant.md`**')
    expect(s).toContain('## Mail recon (before naming)')
    expect(s).toContain('**`search_index`**')
    expect(s).toContain('**`from`**')
    expect(s).toContain('**Before** you ask the user for their name')
    expect(s).toContain('list every calendar')
    expect(s).toContain('**`list_calendars` only**')
    expect(s).toContain('**Do not** call **`op=events`**')
    expect(s).toContain('**finish_conversation**')
    expect(s).toContain('**Greet**')
    expect(s).toContain('**Set the scene**')
    expect(s).toMatch(/numbered agenda|ticket checklist/i)
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
