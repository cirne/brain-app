import { describe, it, expect } from 'vitest'
import { consumeAgentChatStream } from './agentStream.js'
import type { ChatMessage } from './agentUtils.js'

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(c))
      }
      controller.close()
    },
  })
  return new Response(stream)
}

describe('consumeAgentChatStream', () => {
  it('applies session id and text_delta to the assistant message', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    let sessionId: string | null = null
    const res = sseResponse([
      'event: session\n',
      'data: {"sessionId":"sess-1"}\n\n',
      'event: text_delta\n',
      'data: {"delta":"Hello"}\n\n',
    ])
    const { touchedWiki, sawDone } = await consumeAgentChatStream(res, {
      messages,
      msgIdx: 1,
      suppressAgentWikiAutoOpen: false,
      setSessionId: (id) => { sessionId = id },
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(sessionId).toBe('sess-1')
    expect(messages[1].parts![0]).toEqual({ type: 'text', content: 'Hello' })
    expect(touchedWiki).toBe(false)
    expect(sawDone).toBe(false)
  })

  it('sets sawDone when done event is received', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: done\n',
      'data: {}\n\n',
    ])
    const { sawDone } = await consumeAgentChatStream(res, {
      messages,
      msgIdx: 1,
      suppressAgentWikiAutoOpen: false,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(sawDone).toBe(true)
  })
})
