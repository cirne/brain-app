import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { streamStaticAssistantSse } from './streamAgentSse.js'

describe('streamStaticAssistantSse', () => {
  it('calls onTurnComplete with userMessageForPersistence', async () => {
    const persist = vi.fn()
    const app = new Hono()
    app.get('/x', (c) =>
      streamStaticAssistantSse(c, {
        announceSessionId: 'sid-1',
        text: 'Hi',
        userMessageForPersistence: '/foo bar',
        onTurnComplete: persist,
      }),
    )
    const res = await app.request('/x')
    expect(res.status).toBe(200)
    await res.text()
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0][0].userMessage).toBe('/foo bar')
  })
})
