import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { runAgent } from '../agent/index.js'

const chat = new Hono()

// POST /api/chat
// Body: { messages: {role, content}[], context?: string }
// Response: SSE stream of agent events
chat.post('/', async (c) => {
  const { messages, context } = await c.req.json()

  return streamSSE(c, async (stream) => {
    for await (const event of runAgent(messages, { context })) {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event.data),
      })
    }
  })
})

export default chat
