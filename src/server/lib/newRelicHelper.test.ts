import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runWithTenantContext } from './tenantContext.js'

const recordCustomEvent = vi.fn()

vi.mock('newrelic', () => ({
  default: {
    setTransactionName: vi.fn(),
    recordCustomEvent: (...args: unknown[]) => recordCustomEvent(...args),
  },
}))

describe('newRelicHelper', () => {
  beforeEach(() => {
    recordCustomEvent.mockClear()
    process.env.NEW_RELIC_LICENSE_KEY = 'test-license'
  })

  afterEach(() => {
    delete process.env.NEW_RELIC_LICENSE_KEY
  })

  it('sanitizeForNewRelicJson redacts sensitive keys', async () => {
    const { sanitizeForNewRelicJson } = await import('./newRelicHelper.js')
    const s = sanitizeForNewRelicJson({ password: 'x', safe: 'y', nested: { apiKey: 'z' } })
    expect(s).toContain('[redacted]')
    expect(s).toContain('safe')
    expect(s).not.toContain('x')
    expect(s).not.toContain('z')
  })

  it('recordToolCallEnd emits ToolCall with merged workspaceHandle from tenant context', async () => {
    const {
      recordToolCallStart,
      recordToolCallEnd,
      mergeToolCallCorrelation,
    } = await import('./newRelicHelper.js')

    expect(mergeToolCallCorrelation({ sessionId: 'sess-1' }).workspaceHandle).toBeUndefined()

    runWithTenantContext(
      { tenantUserId: 'usr_alice', workspaceHandle: 'alice-ws', homeDir: '/tmp/h' },
      () => {
        recordToolCallStart('tc-1')
        recordToolCallEnd({
          agentTurnId: 'turn-1',
          toolCallId: 'tc-1',
          toolName: 'grep',
          args: { pattern: 'foo' },
          isError: false,
          source: 'chat',
          agentKind: 'chat',
          correlation: { sessionId: 'sess-1' },
        })
      },
    )

    expect(recordCustomEvent).toHaveBeenCalledTimes(1)
    expect(recordCustomEvent).toHaveBeenCalledWith(
      'ToolCall',
      expect.objectContaining({
        toolName: 'grep',
        success: true,
        source: 'chat',
        agentKind: 'chat',
        sessionId: 'sess-1',
        workspaceHandle: 'alice-ws',
        paramsJson: expect.stringContaining('pattern'),
      }),
    )
  })

  it('recordToolCallEnd uses explicit workspaceHandle and backgroundRunId for wiki', async () => {
    const { recordToolCallStart, recordToolCallEnd } = await import('./newRelicHelper.js')
    recordToolCallStart('tc-w')
    recordToolCallEnd({
      agentTurnId: 'turn-w',
      toolCallId: 'tc-w',
      toolName: 'write',
      args: { path: 'a.md' },
      isError: false,
      source: 'wikiExpansion',
      agentKind: 'wiki_enrichment',
      correlation: {
        backgroundRunId: 'run-42',
        workspaceHandle: 'from-caller',
      },
    })

    expect(recordCustomEvent).toHaveBeenCalledWith(
      'ToolCall',
      expect.objectContaining({
        source: 'wikiExpansion',
        agentKind: 'wiki_enrichment',
        backgroundRunId: 'run-42',
        workspaceHandle: 'from-caller',
      }),
    )
  })

  it('does not call New Relic when agent disabled', async () => {
    const saved = process.env.NEW_RELIC_LICENSE_KEY
    delete process.env.NEW_RELIC_LICENSE_KEY
    const { recordToolCallStart, recordToolCallEnd } = await import('./newRelicHelper.js')
    recordToolCallStart('x')
    recordToolCallEnd({
      agentTurnId: 'turn-x',
      toolCallId: 'x',
      toolName: 'read',
      args: {},
      source: 'chat',
      agentKind: 'chat',
    })
    expect(recordCustomEvent).not.toHaveBeenCalled()
    if (saved !== undefined) process.env.NEW_RELIC_LICENSE_KEY = saved
  })

  it('resultSizeBucketFromCharCount returns bounded bands', async () => {
    const { resultSizeBucketFromCharCount } = await import('./newRelicHelper.js')
    expect(resultSizeBucketFromCharCount(0)).toBe('0-1k')
    expect(resultSizeBucketFromCharCount(1023)).toBe('0-1k')
    expect(resultSizeBucketFromCharCount(1024)).toBe('1k-8k')
    expect(resultSizeBucketFromCharCount(8191)).toBe('1k-8k')
    expect(resultSizeBucketFromCharCount(9000)).toBe('8k+')
  })

  it('recordToolCallEnd includes turn correlation and result size', async () => {
    const { recordToolCallStart, recordToolCallEnd, resultSizeBucketFromCharCount } = await import(
      './newRelicHelper.js',
    )
    recordToolCallStart('t1')
    recordToolCallEnd({
      toolCallId: 't1',
      toolName: 'grep',
      args: { pattern: 'x' },
      source: 'chat',
      agentKind: 'chat_skill',
      correlation: { sessionId: 's1' },
      agentTurnId: 'turn-uuid',
      sequence: 2,
      resultCharCount: 500,
      resultTruncated: true,
      resultSizeBucket: resultSizeBucketFromCharCount(500),
    })
    expect(recordCustomEvent).toHaveBeenCalledWith(
      'ToolCall',
      expect.objectContaining({
        agentTurnId: 'turn-uuid',
        sequence: 2,
        resultCharCount: 500,
        resultTruncated: true,
        resultSizeBucket: '0-1k',
        sessionId: 's1',
        agentKind: 'chat_skill',
      }),
    )
  })

  it('recordLlmCompletionsForTurn and recordLlmAgentTurn emit', async () => {
    const { recordLlmCompletionsForTurn, recordLlmAgentTurn } = await import('./newRelicHelper.js')
    const a = {
      role: 'assistant' as const,
      content: [],
      api: 'openai' as const,
      provider: 'openai' as const,
      model: 'gpt-4o',
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
      },
      stopReason: 'stop' as const,
      timestamp: 0,
    }
    const b = { ...a, usage: { ...a.usage, input: 20, output: 10, totalTokens: 30, cost: { ...a.usage.cost, total: 0.02 } } }
    recordLlmCompletionsForTurn(
      { agentTurnId: 't1', source: 'chat', agentKind: 'chat', correlation: { sessionId: 'sess' } },
      [a, b],
    )
    expect(recordCustomEvent).toHaveBeenCalledWith(
      'LlmCompletion',
      expect.objectContaining({
        agentTurnId: 't1',
        agentKind: 'chat',
        completionIndex: 0,
        input: 10,
        sessionId: 'sess',
      }),
    )
    expect(recordCustomEvent).toHaveBeenCalledWith(
      'LlmCompletion',
      expect.objectContaining({ agentTurnId: 't1', completionIndex: 1, input: 20, agentKind: 'chat' }),
    )
    recordCustomEvent.mockClear()
    recordLlmAgentTurn({
      agentTurnId: 't1',
      source: 'wikiExpansion',
      agentKind: 'wiki_enrichment',
      correlation: { backgroundRunId: 'run-1' },
      usage: {
        input: 30,
        output: 15,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 45,
        costTotal: 0.03,
      },
      turnDurationMs: 1200,
      completionCount: 2,
      toolCallCount: 3,
    })
    expect(recordCustomEvent).toHaveBeenCalledWith(
      'LlmAgentTurn',
      expect.objectContaining({
        agentTurnId: 't1',
        source: 'wikiExpansion',
        agentKind: 'wiki_enrichment',
        backgroundRunId: 'run-1',
        turnDurationMs: 1200,
        completionCount: 2,
        toolCallCount: 3,
        costTotal: 0.03,
      }),
    )
  })
})
