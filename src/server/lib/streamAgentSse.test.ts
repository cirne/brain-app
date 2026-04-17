import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type { Agent, AgentEvent } from '@mariozechner/pi-agent-core'
import { streamAgentSseResponse } from './streamAgentSse.js'

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
        await fn({ type: 'agent_end' } as AgentEvent, ac.signal)
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
