import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runWithTenantContext } from './tenantContext.js'

const recordCustomEvent = vi.fn()
const addCustomAttribute = vi.fn()
const setUserID = vi.fn()
const startSegment = vi.fn(
  (name: string, record: boolean, handler: (cb?: () => void) => unknown) => handler(),
)

vi.mock('newrelic', () => ({
  default: {
    setTransactionName: vi.fn(),
    setUserID: (...args: unknown[]) => setUserID(...args),
    recordCustomEvent: (...args: unknown[]) => recordCustomEvent(...args),
    addCustomAttribute: (...args: unknown[]) => addCustomAttribute(...args),
    startSegment: (
      name: string,
      record: boolean,
      handler: (cb?: () => void) => unknown,
      _callback?: () => void,
    ) => startSegment(name, record, handler),
  },
}))

describe('newRelicHelper', () => {
  beforeEach(() => {
    recordCustomEvent.mockClear()
    addCustomAttribute.mockClear()
    setUserID.mockClear()
    startSegment.mockClear()
    startSegment.mockImplementation(
      (name: string, record: boolean, handler: (cb?: () => void) => unknown) => handler(),
    )
    process.env.NEW_RELIC_LICENSE_KEY = 'test-license'
  })

  afterEach(async () => {
    const { releaseAllPendingToolCallSegments } = await import('./newRelicHelper.js')
    releaseAllPendingToolCallSegments()
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
        provider: 'openai',
        model: 'gpt-4o',
      }),
    )
    expect(recordCustomEvent).toHaveBeenCalledWith(
      'LlmCompletion',
      expect.objectContaining({
        agentTurnId: 't1',
        completionIndex: 1,
        input: 20,
        agentKind: 'chat',
        provider: 'openai',
        model: 'gpt-4o',
      }),
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
      provider: 'anthropic',
      model: 'claude-3-5-haiku-latest',
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
        provider: 'anthropic',
        model: 'claude-3-5-haiku-latest',
      }),
    )
  })

  it('recordLlmTurnEndEvents sets LlmAgentTurn provider/model from last assistant completion', async () => {
    const { recordLlmTurnEndEvents } = await import('./newRelicHelper.js')
    const usageCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 }
    const first = {
      role: 'assistant' as const,
      content: [],
      api: 'openai' as const,
      provider: 'openai' as const,
      model: 'gpt-4o-mini',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { ...usageCost, total: 0.001 },
      },
      stopReason: 'stop' as const,
      timestamp: 0,
    }
    const last = {
      ...first,
      model: 'gpt-4o',
      usage: {
        ...first.usage,
        input: 2,
        output: 2,
        totalTokens: 4,
        cost: { ...usageCost, total: 0.002 },
      },
    }
    recordCustomEvent.mockClear()
    recordLlmTurnEndEvents({
      turn: { agentTurnId: 't2', source: 'chat', agentKind: 'chat' },
      messages: [first, last],
      usage: { input: 3, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 6, costTotal: 0.003 },
      turnDurationMs: 100,
      toolCallCount: 0,
    })
    const agentTurnCall = vi.mocked(recordCustomEvent).mock.calls.find((c) => c[0] === 'LlmAgentTurn')
    expect(agentTurnCall?.[1]).toMatchObject({ provider: 'openai', model: 'gpt-4o' })
  })

  it('setAgentTurnTransactionAttribute forwards agentTurnId to addCustomAttribute', async () => {
    const { setAgentTurnTransactionAttribute } = await import('./newRelicHelper.js')
    setAgentTurnTransactionAttribute('urn-turn-1')
    expect(addCustomAttribute).toHaveBeenCalledWith('agentTurnId', 'urn-turn-1')
  })

  it('addTransactionCustomAttributes namespaces keys and skips nullish', async () => {
    const { addTransactionCustomAttributes } = await import('./newRelicHelper.js')
    addTransactionCustomAttributes({
      tenantUserId: 'usr_abc',
      workspaceHandle: 'ws',
      multiTenant: true,
      skipMe: undefined,
      alsoSkip: null,
    })
    expect(addCustomAttribute).toHaveBeenCalledWith('brain.tenantUserId', 'usr_abc')
    expect(addCustomAttribute).toHaveBeenCalledWith('brain.workspaceHandle', 'ws')
    expect(addCustomAttribute).toHaveBeenCalledWith('brain.multiTenant', true)
    expect(addCustomAttribute).not.toHaveBeenCalledWith('brain.skipMe', expect.anything())
  })

  it('addTransactionCustomAttributes leaves dotted keys unprefixed', async () => {
    const { addTransactionCustomAttributes } = await import('./newRelicHelper.js')
    addTransactionCustomAttributes({ 'custom.vendor': 'x' })
    expect(addCustomAttribute).toHaveBeenCalledWith('custom.vendor', 'x')
  })

  it('resolveNewRelicEndUserId maps tenant sentinel and usr ids', async () => {
    const { resolveNewRelicEndUserId } = await import('./newRelicHelper.js')
    const usr =
      'usr_abcdefghijklmnopqrst' as const
    expect(
      resolveNewRelicEndUserId({
        tenantUserId: usr,
        workspaceHandle: 'h',
        homeDir: '/tmp',
      }),
    ).toBe(usr)
    expect(
      resolveNewRelicEndUserId({
        tenantUserId: '_single',
        workspaceHandle: '_single',
        homeDir: '/tmp',
      }),
    ).toBe('single_tenant')
    expect(
      resolveNewRelicEndUserId({
        tenantUserId: '_global',
        workspaceHandle: '_global',
        homeDir: '/tmp',
      }),
    ).toBeUndefined()
  })

  it('applyBrainTenantContextToNewRelicTransaction sets attributes and setUserID for usr tenant', async () => {
    const { applyBrainTenantContextToNewRelicTransaction } = await import('./newRelicHelper.js')
    const usr = 'usr_abcdefghijklmnopqrst'
    runWithTenantContext(
      { tenantUserId: usr, workspaceHandle: 'alice', homeDir: '/tmp/h' },
      () => {
        process.env.BRAIN_DATA_ROOT = '/data'
        applyBrainTenantContextToNewRelicTransaction()
        delete process.env.BRAIN_DATA_ROOT
      },
    )
    expect(addCustomAttribute).toHaveBeenCalledWith('brain.tenantUserId', usr)
    expect(addCustomAttribute).toHaveBeenCalledWith('brain.workspaceHandle', 'alice')
    expect(addCustomAttribute).toHaveBeenCalledWith('brain.multiTenant', true)
    expect(setUserID).toHaveBeenCalledWith(usr)
  })

  it('applyBrainTenantContextToNewRelicTransaction does not call setUserID for embed global tenant', async () => {
    const { applyBrainTenantContextToNewRelicTransaction } = await import('./newRelicHelper.js')
    runWithTenantContext(
      { tenantUserId: '_global', workspaceHandle: '_global', homeDir: '/tmp/g' },
      () => {
        applyBrainTenantContextToNewRelicTransaction()
      },
    )
    expect(addCustomAttribute).toHaveBeenCalledWith('brain.tenantUserId', '_global')
    expect(setUserID).not.toHaveBeenCalled()
  })

  it('beginToolCallSegment registers a startSegment and endToolCallSegmentBridge closes it', async () => {
    const { beginToolCallSegment, endToolCallSegmentBridge } = await import('./newRelicHelper.js')
    beginToolCallSegment('read_email', 'tc-99')
    expect(startSegment).toHaveBeenCalledWith('ai.tool/read_email', true, expect.any(Function))
    endToolCallSegmentBridge('tc-99')
  })
})
