import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getOrCreateSession, deleteSession } from '../agent/index.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { wikiDir } from '../lib/wikiDir.js'

const chat = new Hono()

// POST /api/chat
// Body: { message: string, sessionId?: string, context?: { files?: string[] } }
// Response: SSE stream of agent events
chat.post('/', async (c) => {
  const body = await c.req.json()
  const { message, sessionId = crypto.randomUUID(), context, timezone } = body

  if (!message || typeof message !== 'string') {
    return c.json({ error: 'message is required' }, 400)
  }

  // Build file context if specified (for file-grounded chat)
  let fileContext: string | undefined
  if (context?.files?.length) {
    const parts: string[] = []
    for (const filePath of context.files) {
      try {
        const content = await readFile(join(wikiDir(), filePath), 'utf-8')
        parts.push(`### ${filePath}\n\`\`\`markdown\n${content}\n\`\`\``)
      } catch {
        // Skip files that can't be read
      }
    }
    if (parts.length) fileContext = parts.join('\n\n')
  }

  const agent = await getOrCreateSession(sessionId, { context: fileContext, timezone })

  return streamSSE(c, async (stream) => {
    // Send session ID so client can continue the conversation
    await stream.writeSSE({ event: 'session', data: JSON.stringify({ sessionId }) })

    const unsubscribe = agent.subscribe(async (event) => {
      try {
        switch (event.type) {
          case 'message_update': {
            const e = (event as any).assistantMessageEvent
            if (e?.type === 'text_delta') {
              await stream.writeSSE({
                event: 'text_delta',
                data: JSON.stringify({ delta: e.delta }),
              })
            } else if (e?.type === 'thinking_delta') {
              await stream.writeSSE({
                event: 'thinking',
                data: JSON.stringify({ delta: e.delta }),
              })
            }
            break
          }
          case 'tool_execution_start':
            await stream.writeSSE({
              event: 'tool_start',
              data: JSON.stringify({
                id: (event as any).toolCallId,
                name: (event as any).toolName,
                args: (event as any).args,
              }),
            })
            break
          case 'tool_execution_end': {
            const ev = event as any
            const resultText = ev.result?.content
              ?.filter((c: any) => c.type === 'text')
              ?.map((c: any) => c.text)
              ?.join('') ?? ''
            await stream.writeSSE({
              event: 'tool_end',
              data: JSON.stringify({
                id: ev.toolCallId,
                name: ev.toolName,
                result: resultText.slice(0, 4000),
                isError: ev.isError,
              }),
            })
            break
          }
          case 'agent_end':
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({}),
            })
            break
        }
      } catch {
        // Stream may be closed by client
      }
    })

    try {
      await agent.prompt(message)
    } catch (error: any) {
      try {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: error.message ?? 'Agent error' }),
        })
      } catch {
        // Stream closed
      }
    } finally {
      unsubscribe()
    }
  })
})

// DELETE /api/chat/:sessionId — delete a session
chat.delete('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  deleteSession(sessionId)
  return c.json({ ok: true })
})

export default chat
