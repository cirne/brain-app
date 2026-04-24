import { describe, expect, it } from 'vitest'
import { sanitizeLlmModelIdForFilename } from './effectiveLlmEnv.js'

describe('sanitizeLlmModelIdForFilename', () => {
  it('keeps simple ids', () => {
    expect(sanitizeLlmModelIdForFilename('gpt-5.4-mini')).toBe('gpt-5.4-mini')
    expect(sanitizeLlmModelIdForFilename('gpt-5.4')).toBe('gpt-5.4')
  })
  it('replaces path-like gateway ids with hyphens for one filename segment', () => {
    expect(sanitizeLlmModelIdForFilename('openrouter/anthropic/claude-3.5-sonnet')).toBe(
      'openrouter-anthropic-claude-3.5-sonnet',
    )
  })
})
