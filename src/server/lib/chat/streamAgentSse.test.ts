import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { streamAgentSseResponse } from './streamAgentSse.js'

function mockAssistant(usage: { in: number; out: number; tot: number; cost: number }): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai',
    provider: 'openai',
    model: 'gpt-4o',
    usage: {
      input: usage.in,
      output: usage.out,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: usage.tot,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usage.cost },
    },
    stopReason: 'stop',
    timestamp: 0,
  }
}

/**
 * Minimal Agent that matches pi-agent-core concurrency semantics for prompt/waitForIdle,
 * without LLM or tools. Emits agent_end so streamAgentSseResponse can finish the SSE stream.
 */
class FakeSerialAgent {
  private listener: ((event: AgentEvent, signal: AbortSignal) => void | Promise<void>) | null = null
  private activePromise: Promise<void> | null = null
  /** Max nested prompt() entry — must stay 1 if serialization works */
  maxConcurrentPrompt = 0
  private depth = 0

  constructor(private readonly agentEndEvent: AgentEvent = { type: 'agent_end', messages: [] }) {}

  waitForIdle(): Promise<void> {
    return this.activePromise ?? Promise.resolve()
  }

  subscribe(fn: (event: AgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
    this.listener = fn
    return () => {
      this.listener = null
    }
  }

  async prompt(_input: unknown): Promise<void> {
    if (this.activePromise) {
      throw new Error(
        'Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion',
      )
    }
    let resolve!: () => void
    const p = new Promise<void>((r) => {
      resolve = r
    })
    this.activePromise = p
    this.depth++
    this.maxConcurrentPrompt = Math.max(this.maxConcurrentPrompt, this.depth)
    try {
      const fn = this.listener
      if (fn) {
        const ac = new AbortController()
        await fn(this.agentEndEvent, ac.signal)
      }
    } finally {
      this.depth--
      this.activePromise = null
      resolve()
    }
  }
}

describe('streamAgentSseResponse Agent serialization (BUG-006)', () => {
  it('serializes two concurrent stream handlers on the same Agent (no overlapping prompt)', async () => {
    const wikiDir = '/tmp/stream-agent-sse-test-wiki'
    const fakeAgent = new FakeSerialAgent()
    const agent = fakeAgent as unknown as Agent

    const app = new Hono()
    app.post('/sse', (c) =>
      streamAgentSseResponse(c, agent, 'hello', {
        wikiDirForDiffs: wikiDir,
      }),
    )

    const [r1, r2] = await Promise.all([
      app.request('/sse', { method: 'POST' }),
      app.request('/sse', { method: 'POST' }),
    ])

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    await r1.text()
    await r2.text()

    expect(fakeAgent.maxConcurrentPrompt).toBe(1)
  })

  it('still serializes when session event is written first (await before waitForIdle)', async () => {
    const wikiDir = '/tmp/stream-agent-sse-test-wiki-2'
    const fakeAgent = new FakeSerialAgent()
    const agent = fakeAgent as unknown as Agent
    const sessionId = '00000000-0000-0000-0000-00000000ab12'

    const app = new Hono()
    app.post('/sse', (c) =>
      streamAgentSseResponse(c, agent, 'hello', {
        wikiDirForDiffs: wikiDir,
        announceSessionId: sessionId,
      }),
    )

    const [r1, r2] = await Promise.all([
      app.request('/sse', { method: 'POST' }),
      app.request('/sse', { method: 'POST' }),
    ])

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    const t1 = await r1.text()
    const t2 = await r2.text()
    expect(t1).toContain('session')
    expect(t2).toContain('session')

    expect(fakeAgent.maxConcurrentPrompt).toBe(1)
  })
})

describe('streamAgentSseResponse usage (OPP-043)', () => {
  it('passes summed usage on assistant message from agent_end.messages', async () => {
    const wikiDir = '/tmp/stream-agent-sse-usage-wiki'
    let captured: {
      assistantMessage: {
        usage?: { input: number; output: number; totalTokens: number; costTotal: number }
      }
    } | null = null

    const a = mockAssistant({ in: 10, out: 5, tot: 15, cost: 0.01 })
    const b = mockAssistant({ in: 20, out: 10, tot: 30, cost: 0.02 })
    const fakeAgent = new FakeSerialAgent({ type: 'agent_end', messages: [a, b] } as AgentEvent)
    const agent = fakeAgent as unknown as Agent
    const app = new Hono()
    app.post('/sse', (c) =>
      streamAgentSseResponse(c, agent, 'hi', {
        wikiDirForDiffs: wikiDir,
        onTurnComplete: async (args) => {
          captured = args
        },
      }),
    )

    const res = await app.request('/sse', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(captured).not.toBeNull()
    const u = captured!.assistantMessage.usage
    expect(u).toBeDefined()
    expect(u!.input).toBe(30)
    expect(u!.output).toBe(15)
    expect(u!.totalTokens).toBe(45)
    expect(u!.costTotal).toBeCloseTo(0.03, 5)

    const doneIdx = body.indexOf('event: done')
    expect(doneIdx).toBeGreaterThan(-1)
    const afterDone = body.slice(doneIdx)
    const dataLine = afterDone.split('\n').find((l) => l.startsWith('data: '))
    expect(dataLine).toBeDefined()
    const parsed = JSON.parse(dataLine!.slice('data: '.length)) as {
      usage?: { totalTokens: number; input: number; output: number }
    }
    expect(parsed.usage?.totalTokens).toBe(45)
    expect(parsed.usage?.input).toBe(30)
    expect(parsed.usage?.output).toBe(15)
  })
})
