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
      suppressAgentDetailAutoOpen: false,
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
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(sawDone).toBe(true)
  })

  it('does not call onOpenWiki when isActiveSession is false (tool_start)', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenWiki = vi.fn()
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"t1","name":"write","args":{"path":"ideas/x.md","content":"# x"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => false,
      onOpenWiki,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenWiki).not.toHaveBeenCalled()
  })

  it('does not call onOpenWiki from streaming tool_args (avoids partial path prefixes)', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenWiki = vi.fn()
    const res = sseResponse([
      'event: tool_args\n',
      'data: {"id":"e1","name":"edit","args":{"path":"properties"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      onOpenWiki,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenWiki).not.toHaveBeenCalled()
  })

  it('calls onOpenWiki once from tool_start with normalized path for edit', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenWiki = vi.fn()
    const res = sseResponse([
      'event: tool_args\n',
      'data: {"id":"e1","name":"edit","args":{"path":"properties"}}\n\n',
      'event: tool_start\n',
      'data: {"id":"e1","name":"edit","args":{"path":"properties/son-story-ranch.md","oldText":"a","newText":"b"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      onOpenWiki,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenWiki).toHaveBeenCalledTimes(1)
    expect(onOpenWiki).toHaveBeenCalledWith('properties/son-story-ranch.md')
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
      suppressAgentDetailAutoOpen: true,
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

  it('does not call onOpenFromAgent for read_email when suppressAgentDetailAutoOpen is true', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenFromAgent = vi.fn()
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"e1","name":"read_email","args":{"id":"thread-1"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: true,
      isActiveSession: () => true,
      onOpenFromAgent,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenFromAgent).not.toHaveBeenCalled()
  })

  it('does not call onOpenFromAgent for open when suppressAgentDetailAutoOpen is true', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenFromAgent = vi.fn()
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"o1","name":"open","args":{"target":{"type":"wiki","path":"ideas/x.md"}}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: true,
      isActiveSession: () => true,
      onOpenFromAgent,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenFromAgent).not.toHaveBeenCalled()
  })

  it('calls onOpenFromAgent for open and read_email when suppressAgentDetailAutoOpen is false', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenFromAgent = vi.fn()
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"o1","name":"open","args":{"target":{"type":"wiki","path":"ideas/x.md"}}}\n\n',
      'event: tool_start\n',
      'data: {"id":"e1","name":"read_email","args":{"id":"thread-1"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      onOpenFromAgent,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenFromAgent).toHaveBeenCalledTimes(2)
    expect(onOpenFromAgent).toHaveBeenNthCalledWith(1, { type: 'wiki', path: 'ideas/x.md' }, 'open')
    expect(onOpenFromAgent).toHaveBeenNthCalledWith(2, { type: 'email', id: 'thread-1' }, 'read_email')
  })
})
