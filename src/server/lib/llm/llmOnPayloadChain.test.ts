import { describe, expect, it } from 'vitest'
import { chainLlmOnPayload, chainLlmOnPayloadNoThinking } from './llmOnPayloadChain.js'
import type { OpenAiResponsesPayload } from './openAiResponsesPayload.js'

describe('chainLlmOnPayload vs chainLlmOnPayloadNoThinking', () => {
  it('identical hooks: leave reasoning.effort none for gpt-5.4-mini + MLX untouched', () => {
    const model = {
      provider: 'openai' as const,
      id: 'gpt-5.4-mini',
      reasoning: true,
    }
    const params = { reasoning: { effort: 'none' as const }, model: 'gpt-5.4-mini' }
    expect(chainLlmOnPayload(params, model)).toBeUndefined()
    expect(chainLlmOnPayloadNoThinking(params, model)).toBeUndefined()
  })

  it('both upgrade none→low for codex rejects', () => {
    const model = {
      provider: 'openai' as const,
      id: 'gpt-5-codex',
      reasoning: true,
    }
    const params = {
      reasoning: { effort: 'none' as const, summary: 'auto' },
      include: ['x'] as string[],
    }
    const a = chainLlmOnPayload(params, model) as OpenAiResponsesPayload | undefined
    const b = chainLlmOnPayloadNoThinking(params, model) as OpenAiResponsesPayload | undefined
    expect(a).toEqual(b)
    expect(a?.reasoning).toEqual({ effort: 'low', summary: 'auto' })
    expect(a?.include).toEqual(expect.arrayContaining(['x', 'reasoning.encrypted_content']))
  })
})
