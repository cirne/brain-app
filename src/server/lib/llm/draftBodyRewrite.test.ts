import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const createMock = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

import { rewriteDraftBody } from './draftBodyRewrite.js'

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
  vi.resetAllMocks()
})

describe('rewriteDraftBody', () => {
  it('returns current body when instruction is empty', async () => {
    await expect(rewriteDraftBody('Hello', '  \n')).resolves.toBe('Hello')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('returns rewritten text from Haiku response', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'Dear team,\n\nThanks.\nAmy' }],
    })
    await expect(
      rewriteDraftBody('Dear team,\n\nLong paragraph...', 'make it shorter and sign off Amy'),
    ).resolves.toBe('Dear team,\n\nThanks.\nAmy')
  })

  it('strips optional markdown fences', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '```\nFinal body.\n```' }],
    })
    await expect(rewriteDraftBody('x', 'fix')).resolves.toBe('Final body.')
  })

  it('throws when API key missing', async () => {
    delete process.env.ANTHROPIC_API_KEY
    await expect(rewriteDraftBody('a', 'b')).rejects.toThrow('draft_body_rewrite_requires_llm')
  })

  it('throws on empty model response', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: '   ' }] })
    await expect(rewriteDraftBody('a', 'b')).rejects.toThrow('draft_body_rewrite_empty_response')
  })
})
