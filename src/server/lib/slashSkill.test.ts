import { describe, it, expect } from 'vitest'
import type { UserMessage } from '@mariozechner/pi-ai'
import {
  applySkillPlaceholders,
  buildSkillPromptMessages,
  parseLeadingSlashCommand,
} from './slashSkill.js'

describe('parseLeadingSlashCommand', () => {
  it('parses slug and args', () => {
    expect(parseLeadingSlashCommand('/research quantum')).toEqual({
      slug: 'research',
      args: 'quantum',
    })
  })

  it('returns null when not a leading slash command', () => {
    expect(parseLeadingSlashCommand('hello /research')).toBeNull()
    expect(parseLeadingSlashCommand(' plain')).toBeNull()
  })

  it('allows multiline args', () => {
    const r = parseLeadingSlashCommand('/draft line1\nline2')
    expect(r?.slug).toBe('draft')
    expect(r?.args).toContain('line1')
  })
})

describe('applySkillPlaceholders', () => {
  it('replaces open_file and selection', () => {
    const out = applySkillPlaceholders('See {{open_file}} and {{selection}}', {
      openFile: 'me.md',
      selection: 'ctx',
    })
    expect(out).toBe('See me.md and ctx')
  })
})

describe('buildSkillPromptMessages', () => {
  it('returns two user messages', () => {
    const msgs = buildSkillPromptMessages('tidy', 'body', 'args here')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('user')
    expect(msgs[1].role).toBe('user')
    const u0 = msgs[0] as UserMessage
    const u1 = msgs[1] as UserMessage
    const c0 = u0.content
    const c1 = u1.content
    const t0 = Array.isArray(c0) && c0[0]?.type === 'text' ? c0[0].text : ''
    const t1 = Array.isArray(c1) && c1[0]?.type === 'text' ? c1[0].text : ''
    expect(t0).toContain('## Skill: /tidy')
    expect(t0).toContain('body')
    expect(t1).toContain('args here')
  })
})
