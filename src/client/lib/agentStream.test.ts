import { describe, it, expect, vi } from 'vitest'
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
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentWikiAutoOpen: false,
      isActiveSession: () => true,
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
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentWikiAutoOpen: false,
      isActiveSession: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(sawDone).toBe(true)
  })

  it('does not call onOpenWiki when isActiveSession is false', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenWiki = vi.fn()
    const res = sseResponse([
      'event: tool_args\n',
      'data: {"id":"t1","name":"write","args":{"path":"ideas/x.md","content":"# x"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentWikiAutoOpen: false,
      isActiveSession: () => false,
      onOpenWiki,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenWiki).not.toHaveBeenCalled()
  })

  it('adds an in-progress tool part on tool_args for write (mirrors server transcript)', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_args\n',
      'data: {"id":"w1","name":"write","args":{"path":"companies/new-relic.md","content":"# NR"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentWikiAutoOpen: true,
      isActiveSession: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(messages[1].parts).toHaveLength(1)
    const p = messages[1].parts![0]
    expect(p.type).toBe('tool')
    if (p.type !== 'tool') throw new Error('expected tool part')
    expect(p.toolCall.id).toBe('w1')
    expect(p.toolCall.name).toBe('write')
    expect(p.toolCall.done).toBe(false)
    expect((p.toolCall.args as { path?: string }).path).toBe('companies/new-relic.md')
  })
})
