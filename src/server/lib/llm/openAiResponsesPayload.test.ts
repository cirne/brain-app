import { describe, expect, it } from 'vitest'
import { patchOpenAiReasoningNoneEffort } from './openAiResponsesPayload.js'

describe('patchOpenAiReasoningNoneEffort', () => {
  it('no-ops when model is not a reasoning model', () => {
    expect(
      patchOpenAiReasoningNoneEffort(
        { reasoning: { effort: 'none' } },
        { id: 'gpt-4o', reasoning: false },
      ),
    ).toBeUndefined()
  })

  it('no-ops when effort is not none', () => {
    expect(
      patchOpenAiReasoningNoneEffort(
        { reasoning: { effort: 'medium' } },
        { id: 'gpt-5-codex', reasoning: true },
      ),
    ).toBeUndefined()
  })

  it('maps none to low and adds encrypted_content include', () => {
    const next = patchOpenAiReasoningNoneEffort(
      { model: 'gpt-5-codex', reasoning: { effort: 'none' }, include: ['other'] },
      { id: 'gpt-5-codex', reasoning: true },
    )
    expect(next?.reasoning).toEqual({ effort: 'low', summary: 'auto' })
    expect(next?.include).toEqual(expect.arrayContaining(['other', 'reasoning.encrypted_content']))
  })

  it('no-ops for reasoning gpt-5.4-mini when effort is none (assistant thinking off)', () => {
    expect(
      patchOpenAiReasoningNoneEffort(
        { reasoning: { effort: 'none' } },
        { id: 'gpt-5.4-mini', reasoning: true },
      ),
    ).toBeUndefined()
  })
})
