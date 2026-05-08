import { describe, it, expect } from 'vitest'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import { createRejectQuestionTool } from './rejectQuestionTool.js'

const testToolCtx = {} as ExtensionContext

describe('createRejectQuestionTool', () => {
  it('returns caller-facing text and structured details', async () => {
    const tool = createRejectQuestionTool()
    expect(tool.name).toBe('reject_question')
    const out = await tool.execute(
      'tc_1',
      {
      reason: 'overly_broad',
      explanation:
        'That question is too open-ended. Ask something specific with a clear purpose—for example, about a named project or date range.',
      },
      undefined,
      undefined,
      testToolCtx,
    )
    expect(out.details?.rejected).toBe(true)
    if (out.details?.rejected === true) {
      expect(out.details.reason).toBe('overly_broad')
      expect(out.details.explanation).toContain('specific')
    }
    const text = out.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
    expect(text).toContain('specific')
  })

  it('falls back when explanation is whitespace-only', async () => {
    const tool = createRejectQuestionTool()
    const out = await tool.execute(
      'tc_2',
      {
        reason: 'other',
        explanation: '   ',
      },
      undefined,
      undefined,
      testToolCtx,
    )
    const text = out.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
    expect(text.length).toBeGreaterThan(10)
    if (out.details?.rejected === true) {
      expect(out.details.explanation.length).toBeGreaterThan(10)
    }
  })
})
