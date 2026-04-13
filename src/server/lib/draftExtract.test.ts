import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the Anthropic SDK before importing
const createMock = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import { extractDraftEdits } from './draftExtract.js'

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
  vi.resetAllMocks()
})

describe('extractDraftEdits', () => {
  it('extracts add_cc from natural language', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"add_cc": ["bob@example.com"], "body_instruction": "make it shorter"}' }],
    })
    const result = await extractDraftEdits('add bob@example.com to cc and make it shorter')
    expect(result.add_cc).toEqual(['bob@example.com'])
    expect(result.body_instruction).toBe('make it shorter')
  })

  it('extracts subject change', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"subject": "Quick update"}' }],
    })
    const result = await extractDraftEdits('change subject to Quick update')
    expect(result.subject).toBe('Quick update')
    expect(result.body_instruction).toBeUndefined()
  })

  it('handles body-only instruction', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"body_instruction": "make it more formal"}' }],
    })
    const result = await extractDraftEdits('make it more formal')
    expect(result.body_instruction).toBe('make it more formal')
    expect(result.add_cc).toBeUndefined()
  })

  it('handles JSON wrapped in markdown code block', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '```json\n{"add_bcc": ["secret@x.com"]}\n```' }],
    })
    const result = await extractDraftEdits('bcc secret@x.com')
    expect(result.add_bcc).toEqual(['secret@x.com'])
  })

  it('falls back to body_instruction when no API key', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const result = await extractDraftEdits('add bob to cc')
    expect(result).toEqual({ body_instruction: 'add bob to cc' })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('falls back to body_instruction when LLM call fails', async () => {
    createMock.mockRejectedValue(new Error('API error'))
    const result = await extractDraftEdits('add bob to cc')
    expect(result).toEqual({ body_instruction: 'add bob to cc' })
  })

  it('falls back to body_instruction when LLM returns invalid JSON', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'not valid json' }],
    })
    const result = await extractDraftEdits('something')
    expect(result).toEqual({ body_instruction: 'something' })
  })
})
