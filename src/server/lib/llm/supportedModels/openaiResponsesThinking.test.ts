import { describe, expect, it } from 'vitest'
import {
  MODEL_IDS_REJECTING_OPENAI_REASONING_EFFORT_NONE,
  normalizeOpenAiStyleModelId,
  openAiResponsesModelRejectsReasoningEffortNone,
} from './openaiResponsesThinking.js'

describe('openAiResponsesThinking', () => {
  it('normalizeOpenAiStyleModelId strips optional provider prefix', () => {
    expect(normalizeOpenAiStyleModelId('openai/gpt-5.4-mini')).toBe('gpt-5.4-mini')
    expect(normalizeOpenAiStyleModelId('gpt-5.4-mini')).toBe('gpt-5.4-mini')
    expect(normalizeOpenAiStyleModelId('  openai/foo  ')).toBe('foo')
  })

  it('GPT-5.4-mini is not in the reject list (leave effort none for thinking off)', () => {
    expect(openAiResponsesModelRejectsReasoningEffortNone('gpt-5.4-mini')).toBe(false)
    expect(openAiResponsesModelRejectsReasoningEffortNone('openai/gpt-5.4-mini')).toBe(false)
  })

  it('codex-line models require none→low workaround', () => {
    for (const id of MODEL_IDS_REJECTING_OPENAI_REASONING_EFFORT_NONE) {
      expect(openAiResponsesModelRejectsReasoningEffortNone(id)).toBe(true)
      expect(openAiResponsesModelRejectsReasoningEffortNone(`OPENAI/${id}`)).toBe(true)
    }
  })
})
