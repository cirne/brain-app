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
      { workspaceHandle: 'alice-ws', homeDir: '/tmp/h' },
      () => {
        recordToolCallStart('tc-1')
        recordToolCallEnd({
          toolCallId: 'tc-1',
          toolName: 'grep',
          args: { pattern: 'foo' },
          isError: false,
          source: 'chat',
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
      toolCallId: 'tc-w',
      toolName: 'write',
      args: { path: 'a.md' },
      isError: false,
      source: 'wikiExpansion',
      correlation: {
        backgroundRunId: 'run-42',
        workspaceHandle: 'from-caller',
      },
    })

    expect(recordCustomEvent).toHaveBeenCalledWith(
      'ToolCall',
      expect.objectContaining({
        source: 'wikiExpansion',
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
      toolCallId: 'x',
      toolName: 'read',
      args: {},
      source: 'chat',
    })
    expect(recordCustomEvent).not.toHaveBeenCalled()
    if (saved !== undefined) process.env.NEW_RELIC_LICENSE_KEY = saved
  })
})
