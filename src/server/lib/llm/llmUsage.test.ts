import { describe, expect, it } from 'vitest'
import {
  addLlmUsage,
  countAssistantCompletionsWithUsage,
  isZeroUsage,
  rollupAssistantLlmIds,
  sumUsageFromMessages,
  type LlmUsageSnapshot,
} from './llmUsage.js'
import type { AssistantMessage } from '@earendil-works/pi-ai'

function mockAssistant(usage: {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens: number
  costTotal?: number
}): AssistantMessage {
  const costTotal = usage.costTotal ?? 0
  return {
    role: 'assistant',
    content: [],
    api: 'openai' as const,
    provider: 'openai' as const,
    model: 'gpt-4o',
    usage: {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      totalTokens: usage.totalTokens,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: costTotal,
      },
    },
    stopReason: 'stop',
    timestamp: 0,
  }
}

describe('sumUsageFromMessages', () => {
  it('returns zeros for empty messages', () => {
    const s = sumUsageFromMessages([])
    expect(s).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      costTotal: 0,
    })
    expect(isZeroUsage(s)).toBe(true)
  })

  it('sums two assistant messages (multi-round tool use)', () => {
    const a = mockAssistant({ input: 100, output: 50, totalTokens: 150, costTotal: 0.01 })
    const b = mockAssistant({ input: 200, output: 80, cacheRead: 50, totalTokens: 330, costTotal: 0.02 })
    const s = sumUsageFromMessages([a, b])
    expect(s.input).toBe(300)
    expect(s.output).toBe(130)
    expect(s.cacheRead).toBe(50)
    expect(s.totalTokens).toBe(480)
    expect(s.costTotal).toBeCloseTo(0.03, 5)
  })

  it('ignores user messages in the array', () => {
    const u = { role: 'user' as const, content: 'hi', timestamp: 1 }
    const a = mockAssistant({ input: 10, output: 5, totalTokens: 15, costTotal: 0 })
    const s = sumUsageFromMessages([u, a])
    expect(s.input).toBe(10)
    expect(s.totalTokens).toBe(15)
  })
})

describe('countAssistantCompletionsWithUsage', () => {
  it('counts only assistant messages with usage', () => {
    const a = mockAssistant({ input: 1, output: 1, totalTokens: 2, costTotal: 0 })
    const b = mockAssistant({ input: 1, output: 1, totalTokens: 2, costTotal: 0 })
    const u = { role: 'user' as const, content: 'hi', timestamp: 1 }
    expect(countAssistantCompletionsWithUsage([u, a, b])).toBe(2)
    expect(countAssistantCompletionsWithUsage([])).toBe(0)
  })
})

describe('addLlmUsage', () => {
  it('adds two snapshots field-wise', () => {
    const a: LlmUsageSnapshot = {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
      costTotal: 0.5,
    }
    const b: LlmUsageSnapshot = {
      input: 10,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      totalTokens: 100,
      costTotal: 1.5,
    }
    expect(addLlmUsage(a, b)).toEqual({
      input: 11,
      output: 22,
      cacheRead: 33,
      cacheWrite: 44,
      totalTokens: 110,
      costTotal: 2,
    })
  })
})

describe('rollupAssistantLlmIds', () => {
  it('uses the last assistant message with usage for provider/model', () => {
    const first = mockAssistant({ input: 1, output: 1, totalTokens: 2, costTotal: 0 })
    const second = {
      ...mockAssistant({ input: 2, output: 2, totalTokens: 4, costTotal: 0 }),
      model: 'gpt-5.4-mini',
      provider: 'openai' as const,
    }
    expect(rollupAssistantLlmIds([first, second] as never[])).toEqual({
      model: 'gpt-5.4-mini',
      provider: 'openai',
    })
  })
})

