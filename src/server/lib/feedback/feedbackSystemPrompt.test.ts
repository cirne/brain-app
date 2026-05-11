import { describe, expect, it } from 'vitest'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'

describe('feedback/system.hbs (product feedback drafting)', () => {
  it('requires preserving diagnostics (tools, prompts) while redacting secrets', () => {
    const prompt = renderPromptTemplate('feedback/system.hbs', {})
    expect(prompt).toContain('tool')
    expect(prompt).toMatch(/reproduc|diagnos/i)
    expect(prompt).not.toContain('Do not include full chat logs')
    expect(prompt).toMatch(/API key|password|secret|token/i)
  })
})
