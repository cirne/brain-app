import { describe, it, expect, vi, beforeEach } from 'vitest'
import { consumeAgentChatStream } from './agentStream.js'
import type { ChatMessage } from './agentUtils.js'
import { playBrainTtsBlob } from './brainTtsAudio.js'
import * as appEvents from './app/appEvents.js'

vi.mock('./brainTtsAudio.js', () => ({
  playBrainTtsBlob: vi.fn().mockResolvedValue(undefined),
  primeBrainTtsFromUserGesture: vi.fn(),
  stopBrainTtsPlayback: vi.fn(),
}))

vi.mock('./app/appEvents.js', () => ({
  emit: vi.fn(),
}))

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
      isHearRepliesEnabled: () => true,
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
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(sawDone).toBe(true)
  })

  it('applies usage from done event to the assistant message and calls touchMessages', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const touchMessages = vi.fn()
    const res = sseResponse([
      'event: done\n',
      'data: {"usage":{"input":10,"output":5,"cacheRead":0,"cacheWrite":0,"totalTokens":15,"costTotal":0.01}}\n\n',
    ])
    const { sawDone } = await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages,
      scrollToBottom: () => {},
    })
    expect(sawDone).toBe(true)
    expect(messages[1].usage).toEqual({
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      costTotal: 0.01,
    })
    expect(touchMessages).toHaveBeenCalledTimes(1)
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
      isHearRepliesEnabled: () => true,
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
      isHearRepliesEnabled: () => true,
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
      isHearRepliesEnabled: () => true,
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
      isHearRepliesEnabled: () => true,
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

  it('does not call onOpenFromAgent for read_mail_message when suppressAgentDetailAutoOpen is true', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenFromAgent = vi.fn()
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"e1","name":"read_mail_message","args":{"id":"thread-1"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: true,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
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
      isHearRepliesEnabled: () => true,
      onOpenFromAgent,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenFromAgent).not.toHaveBeenCalled()
  })

  it('calls onOpenFromAgent for open but not read_mail_message when suppressAgentDetailAutoOpen is false', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenFromAgent = vi.fn()
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"o1","name":"open","args":{"target":{"type":"wiki","path":"ideas/x.md"}}}\n\n',
      'event: tool_start\n',
      'data: {"id":"e1","name":"read_mail_message","args":{"id":"thread-1"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      onOpenFromAgent,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenFromAgent).toHaveBeenCalledTimes(1)
    expect(onOpenFromAgent).toHaveBeenCalledWith({ type: 'wiki', path: 'ideas/x.md' }, 'open')
  })

  it('calls onOpenDraftFromAgent on draft_email tool_end when detail auto-open allowed', async () => {
    vi.mocked(appEvents.emit).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenDraftFromAgent = vi.fn()
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"de1","name":"draft_email","result":"{}","isError":false,"details":{"id":"draft-x","subject":"Hello"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      onOpenDraftFromAgent,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenDraftFromAgent).toHaveBeenCalledWith('draft-x', 'Hello')
    expect(vi.mocked(appEvents.emit)).toHaveBeenCalledWith({
      type: 'email-draft:refresh',
      draftId: 'draft-x',
    })
  })

  it('does not call onOpenDraftFromAgent for draft_email when suppressAgentDetailAutoOpen', async () => {
    vi.mocked(appEvents.emit).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenDraftFromAgent = vi.fn()
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"de1","name":"draft_email","result":"{}","isError":false,"details":{"id":"draft-x","subject":"Hello"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: true,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      onOpenDraftFromAgent,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenDraftFromAgent).not.toHaveBeenCalled()
    expect(vi.mocked(appEvents.emit)).toHaveBeenCalledWith({
      type: 'email-draft:refresh',
      draftId: 'draft-x',
    })
  })

  it('does not call onOpenDraftFromAgent for edit_draft tool_end', async () => {
    vi.mocked(appEvents.emit).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenDraftFromAgent = vi.fn()
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"ed1","name":"edit_draft","result":"{}","isError":false,"details":{"id":"draft-x","subject":"Hello"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      onOpenDraftFromAgent,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenDraftFromAgent).not.toHaveBeenCalled()
    expect(vi.mocked(appEvents.emit)).toHaveBeenCalledWith({
      type: 'email-draft:refresh',
      draftId: 'draft-x',
    })
  })

  it('invokes playBrainTtsBlob after tts_done when playTts is openai', async () => {
    vi.mocked(playBrainTtsBlob).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const b64a = btoa(String.fromCharCode(255, 251, 144))
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"s1","name":"speak","result":"Hello","isError":false,"playTts":"openai"}\n\n',
      'event: tts_chunk\n',
      `data: {"id":"s1","b64":"${b64a}"}\n\n`,
      'event: tts_done\n',
      'data: {"id":"s1","format":"mp3"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(playBrainTtsBlob)).toHaveBeenCalled()
    const arg = vi.mocked(playBrainTtsBlob).mock.calls[0]![0] as Blob
    expect(arg).toBeInstanceOf(Blob)
    const opts = vi.mocked(playBrainTtsBlob).mock.calls[0]![1] as { continuePlayback?: () => boolean }
    expect(opts?.continuePlayback).toBeTypeOf('function')
  })

  it('passes continuePlayback that tracks isActiveSession and isHearRepliesEnabled', async () => {
    vi.mocked(playBrainTtsBlob).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    let active = true
    let hear = true
    const b64a = btoa(String.fromCharCode(255, 251, 144))
    const res = sseResponse([
      'event: tts_chunk\n',
      `data: {"id":"s1","b64":"${b64a}"}\n\n`,
      'event: tts_done\n',
      'data: {"id":"s1","format":"mp3"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => active,
      isHearRepliesEnabled: () => hear,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(playBrainTtsBlob)).toHaveBeenCalled()
    const opts = vi.mocked(playBrainTtsBlob).mock.calls[0]![1] as { continuePlayback: () => boolean }
    expect(opts.continuePlayback()).toBe(true)
    active = false
    expect(opts.continuePlayback()).toBe(false)
    active = true
    hear = false
    expect(opts.continuePlayback()).toBe(false)
  })

  it('completes without throwing on tts_error (no TTS play)', async () => {
    vi.mocked(playBrainTtsBlob).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"s1","name":"speak","result":"Hello","isError":false,"playTts":"openai"}\n\n',
      'event: tts_error\n',
      'data: {"id":"s1","message":"api down"}\n\n',
    ])
    await expect(
      consumeAgentChatStream(res, {
        getMessages: () => messages,
        msgIdx: 1,
        suppressAgentDetailAutoOpen: false,
        isActiveSession: () => true,
        isHearRepliesEnabled: () => true,
        setSessionId: () => {},
        setChatTitle: () => {},
        touchMessages: () => {},
        scrollToBottom: () => {},
      }),
    ).resolves.toEqual({ touchedWiki: false, sawDone: false, deferredFinishConversation: false })
    expect(vi.mocked(playBrainTtsBlob)).not.toHaveBeenCalled()
  })

  it('does not play TTS when isHearRepliesEnabled returns false', async () => {
    vi.mocked(playBrainTtsBlob).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const b64a = btoa(String.fromCharCode(255, 251, 144))
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"s1","name":"speak","result":"Hello","isError":false,"playTts":"openai"}\n\n',
      'event: tts_chunk\n',
      `data: {"id":"s1","b64":"${b64a}"}\n\n`,
      'event: tts_done\n',
      'data: {"id":"s1","format":"mp3"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => false,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(playBrainTtsBlob)).not.toHaveBeenCalled()
  })

  it('returns early when response body is null', async () => {
    const res = new Response(null)
    const { touchedWiki, sawDone } = await consumeAgentChatStream(res, {
      getMessages: () => [],
      msgIdx: 0,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(touchedWiki).toBe(false)
    expect(sawDone).toBe(false)
  })

  it('handles chat_title event and trims/limits title', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    let chatTitle: string | null = null
    const res = sseResponse([
      'event: chat_title\n',
      'data: {"title":"  My Chat Title  "}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: (t) => { chatTitle = t },
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(chatTitle).toBe('My Chat Title')
  })

  it('ignores chat_title event with empty title', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    let chatTitle: string | null = 'original'
    const res = sseResponse([
      'event: chat_title\n',
      'data: {"title":"   "}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: (t) => { chatTitle = t },
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(chatTitle).toBe('original')
  })

  it('handles thinking event and appends delta to msg.thinking', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: thinking\n',
      'data: {"delta":"First thought..."}\n\n',
      'event: thinking\n',
      'data: {"delta":" Second thought."}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(messages[1].thinking).toBe('First thought... Second thought.')
  })

  it('handles error event and adds error text part', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: error\n',
      'data: {"message":"Something went wrong"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(messages[1].parts).toHaveLength(1)
    expect(messages[1].parts![0]).toEqual({
      type: 'text',
      content: '\n\n**Error:** Something went wrong',
    })
  })

  it('appends text_delta to existing text part', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [{ type: 'text', content: 'Hello' }] },
    ]
    const res = sseResponse([
      'event: text_delta\n',
      'data: {"delta":" world"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(messages[1].parts).toHaveLength(1)
    expect(messages[1].parts![0]).toEqual({ type: 'text', content: 'Hello world' })
  })

  it('skips message processing when msgIdx points to non-assistant message', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
    ]
    const touchMessages = vi.fn()
    const res = sseResponse([
      'event: text_delta\n',
      'data: {"delta":"ignored"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 0,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages,
      scrollToBottom: () => {},
    })
    expect(touchMessages).not.toHaveBeenCalled()
  })

  it('handles set_chat_title tool and updates title from args', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    let chatTitle: string | null = null
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"t1","name":"set_chat_title","args":{"title":"  Agent Set Title  "}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: (t) => { chatTitle = t },
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(chatTitle).toBe('Agent Set Title')
    expect(messages[1].parts).toHaveLength(1)
    const p = messages[1].parts![0]
    expect(p.type).toBe('tool')
  })

  it('updates existing tool part in set_chat_title (tool_args then tool_start)', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [
        { type: 'tool', toolCall: { id: 't1', name: 'set_chat_title', args: {}, done: false } },
      ]},
    ]
    let chatTitle: string | null = null
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"t1","name":"set_chat_title","args":{"title":"Updated Title"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: (t) => { chatTitle = t },
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(chatTitle).toBe('Updated Title')
    expect(messages[1].parts).toHaveLength(1)
  })

  it('read_indexed_file with filesystem path does not call onOpenFromAgent', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenFromAgent = vi.fn()
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"e1","name":"read_indexed_file","args":{"id":"/Users/test/mail.eml"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      onOpenFromAgent,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenFromAgent).not.toHaveBeenCalled()
    expect(messages[1].parts).toHaveLength(1)
    const p = messages[1].parts![0]
    expect(p.type).toBe('tool')
    if (p.type !== 'tool') throw new Error('expected tool part')
    expect(p.toolCall.name).toBe('read_indexed_file')
    expect((p.toolCall.args as { id?: string }).id).toBe('/Users/test/mail.eml')
  })

  it('read_indexed_file with Drive id does not call onOpenFromAgent', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onOpenFromAgent = vi.fn()
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"e2","name":"read_indexed_file","args":{"id":"1aEUa2RqJabc","source":"user-drive"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      onOpenFromAgent,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onOpenFromAgent).not.toHaveBeenCalled()
    const p = messages[1].parts![0]
    expect(p.type).toBe('tool')
    if (p.type !== 'tool') throw new Error('expected tool part')
    expect((p.toolCall.args as { id?: string; source?: string }).id).toBe('1aEUa2RqJabc')
    expect((p.toolCall.args as { source?: string }).source).toBe('user-drive')
  })

  it('calls onFinishConversation when finish_conversation tool ends successfully', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onFinishConversation = vi.fn()
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"fc1","name":"finish_conversation","args":{},"result":"ok","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
      onFinishConversation,
    })
    expect(onFinishConversation).toHaveBeenCalledTimes(1)
  })

  it('does not call onFinishConversation when finish_conversation ends with error', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onFinishConversation = vi.fn()
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"fc1","name":"finish_conversation","args":{},"result":"err","isError":true}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
      onFinishConversation,
    })
    expect(onFinishConversation).not.toHaveBeenCalled()
  })

  it('emits hub:sources-changed on manage_sources with add op', async () => {
    vi.mocked(appEvents.emit).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"m1","name":"manage_sources","args":{"op":"add"},"result":"ok","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(appEvents.emit)).toHaveBeenCalledWith({ type: 'hub:sources-changed' })
  })

  it('emits hub:sources-changed on refresh_sources tool_end', async () => {
    vi.mocked(appEvents.emit).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"r1","name":"refresh_sources","result":"ok","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(appEvents.emit)).toHaveBeenCalledWith({ type: 'hub:sources-changed' })
  })

  it('sets touchedWiki true for delete_file tool_end', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"d1","name":"delete_file","args":{"path":"ideas/old.md"},"result":"deleted","isError":false}\n\n',
    ])
    const { touchedWiki } = await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(touchedWiki).toBe(true)
  })

  it('sets touchedWiki true for rmdir tool_end', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"r1","name":"rmdir","args":{"path":"scratch/empty"},"result":"removed","isError":false}\n\n',
    ])
    const { touchedWiki } = await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(touchedWiki).toBe(true)
  })

  it('creates new tool part on tool_end when none exists', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"x1","name":"search","args":{"query":"test"},"result":"found","details":{"count":5},"isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(messages[1].parts).toHaveLength(1)
    const p = messages[1].parts![0]
    expect(p.type).toBe('tool')
    if (p.type !== 'tool') throw new Error('expected tool part')
    expect(p.toolCall.id).toBe('x1')
    expect(p.toolCall.done).toBe(true)
    expect(p.toolCall.result).toBe('found')
    expect(p.toolCall.details).toEqual({ count: 5 })
  })

  it('ignores tts_chunk with missing id', async () => {
    vi.mocked(playBrainTtsBlob).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tts_chunk\n',
      'data: {"b64":"dGVzdA=="}\n\n',
      'event: tts_done\n',
      'data: {"format":"mp3"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(playBrainTtsBlob)).not.toHaveBeenCalled()
  })

  it('skips TTS play when tts_done has zero-size blob', async () => {
    vi.mocked(playBrainTtsBlob).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tts_done\n',
      'data: {"id":"s1","format":"mp3"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(playBrainTtsBlob)).not.toHaveBeenCalled()
  })

  it('handles tts_done with opus format', async () => {
    vi.mocked(playBrainTtsBlob).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const b64a = btoa(String.fromCharCode(1, 2, 3))
    const res = sseResponse([
      'event: tts_chunk\n',
      `data: {"id":"s1","b64":"${b64a}"}\n\n`,
      'event: tts_done\n',
      'data: {"id":"s1","format":"opus"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(playBrainTtsBlob)).toHaveBeenCalled()
    const blob = vi.mocked(playBrainTtsBlob).mock.calls[0]![0] as Blob
    expect(blob.type).toBe('audio/ogg')
  })

  it.each([
    ['aac', 'audio/aac'],
    ['flac', 'audio/flac'],
    ['wav', 'audio/wav'],
    ['pcm', 'audio/pcm'],
    ['unknown', 'audio/mpeg'],
  ])('handles tts_done with %s format', async (format, expectedMime) => {
    vi.mocked(playBrainTtsBlob).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const b64a = btoa(String.fromCharCode(1, 2, 3))
    const res = sseResponse([
      'event: tts_chunk\n',
      `data: {"id":"s1","b64":"${b64a}"}\n\n`,
      'event: tts_done\n',
      `data: {"id":"s1","format":"${format}"}\n\n`,
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(playBrainTtsBlob)).toHaveBeenCalled()
    const blob = vi.mocked(playBrainTtsBlob).mock.calls[0]![0] as Blob
    expect(blob.type).toBe(expectedMime)
  })

  it('calls onWriteStreaming on tool_args and tool_end for write tool', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onWriteStreaming = vi.fn()
    const res = sseResponse([
      'event: tool_args\n',
      'data: {"id":"w1","name":"write","args":{"path":"test.md","content":"# Test"}}\n\n',
      'event: tool_end\n',
      'data: {"id":"w1","name":"write","result":"ok","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      onWriteStreaming,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onWriteStreaming).toHaveBeenCalledTimes(2)
    expect(onWriteStreaming).toHaveBeenNthCalledWith(1, { path: 'test.md', content: '# Test', done: false })
    expect(onWriteStreaming).toHaveBeenNthCalledWith(2, { path: '', content: '', done: true })
  })

  it('calls onEditStreaming on tool_args and tool_end for edit tool', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onEditStreaming = vi.fn()
    const res = sseResponse([
      'event: tool_args\n',
      'data: {"id":"e1","name":"edit","args":{"path":"test.md"}}\n\n',
      'event: tool_end\n',
      'data: {"id":"e1","name":"edit","result":"ok","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      onEditStreaming,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onEditStreaming).toHaveBeenCalledTimes(2)
    expect(onEditStreaming).toHaveBeenNthCalledWith(1, { id: 'e1', path: 'test.md', done: false })
    expect(onEditStreaming).toHaveBeenNthCalledWith(2, { id: 'e1', path: '', done: true })
  })

  it('does not call scrollToBottom when isActiveSession returns false', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const scrollToBottom = vi.fn()
    const res = sseResponse([
      'event: text_delta\n',
      'data: {"delta":"hi"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => false,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom,
    })
    expect(scrollToBottom).not.toHaveBeenCalled()
  })

  it('handles SSE chunks split across multiple reads', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const enc = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode('event: text_del'))
        controller.enqueue(enc.encode('ta\ndata: {"delta":"Hel'))
        controller.enqueue(enc.encode('lo"}\n\n'))
        controller.close()
      },
    })
    const res = new Response(stream)
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(messages[1].parts![0]).toEqual({ type: 'text', content: 'Hello' })
  })

  it('updates existing tool part args on tool_args', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [
        { type: 'tool', toolCall: { id: 'w1', name: 'write', args: { path: 'old.md' }, done: false } },
      ]},
    ]
    const res = sseResponse([
      'event: tool_args\n',
      'data: {"id":"w1","name":"write","args":{"path":"new.md","content":"updated"}}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(messages[1].parts).toHaveLength(1)
    const p = messages[1].parts![0]
    if (p.type !== 'tool') throw new Error('expected tool part')
    expect(p.toolCall.args).toEqual({ path: 'new.md', content: 'updated' })
  })

  it('uses stashed args from tool_start when tool_end has no args', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"s1","name":"search","args":{"query":"test"}}\n\n',
      'event: tool_end\n',
      'data: {"id":"s1","name":"search","result":"found","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    const p = messages[1].parts![0]
    if (p.type !== 'tool') throw new Error('expected tool part')
    expect(p.toolCall.args).toEqual({ query: 'test' })
  })

  it('handles manage_sources with reindex op', async () => {
    vi.mocked(appEvents.emit).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"m1","name":"manage_sources","args":{"op":"reindex"},"result":"ok","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(appEvents.emit)).toHaveBeenCalledWith({ type: 'hub:sources-changed' })
  })

  it('does not emit hub:sources-changed on manage_sources with isError true', async () => {
    vi.mocked(appEvents.emit).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"m1","name":"manage_sources","args":{"op":"add"},"result":"failed","isError":true}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(appEvents.emit)).not.toHaveBeenCalled()
  })

  it('initializes parts array if missing on assistant message', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '' },
    ]
    const res = sseResponse([
      'event: text_delta\n',
      'data: {"delta":"Hello"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(messages[1].parts).toBeDefined()
    expect(messages[1].parts![0]).toEqual({ type: 'text', content: 'Hello' })
  })

  it('updates existing tool part args from tool_end when no stashed args', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [
        { type: 'tool', toolCall: { id: 'x1', name: 'search', args: { old: 'value' }, done: false } },
      ]},
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"x1","name":"search","args":{"query":"new"},"result":"ok","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    const p = messages[1].parts![0]
    if (p.type !== 'tool') throw new Error('expected tool')
    expect(p.toolCall.args).toEqual({ query: 'new' })
    expect(p.toolCall.done).toBe(true)
  })

  it('handles manage_sources with remove op', async () => {
    vi.mocked(appEvents.emit).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"m1","name":"manage_sources","args":{"op":"remove"},"result":"ok","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(appEvents.emit)).toHaveBeenCalledWith({ type: 'hub:sources-changed' })
  })

  it('handles manage_sources with edit op', async () => {
    vi.mocked(appEvents.emit).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"m1","name":"manage_sources","args":{"op":"edit"},"result":"ok","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(appEvents.emit)).toHaveBeenCalledWith({ type: 'hub:sources-changed' })
  })

  it('does not emit for manage_sources with list op (read-only)', async () => {
    vi.mocked(appEvents.emit).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"m1","name":"manage_sources","args":{"op":"list"},"result":"[]","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(appEvents.emit)).not.toHaveBeenCalled()
  })

  it('does not emit for refresh_sources with isError true', async () => {
    vi.mocked(appEvents.emit).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_end\n',
      'data: {"id":"r1","name":"refresh_sources","result":"failed","isError":true}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(appEvents.emit)).not.toHaveBeenCalled()
  })

  it('does not call onWriteStreaming/onEditStreaming when isActiveSession is false', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const onWriteStreaming = vi.fn()
    const onEditStreaming = vi.fn()
    const res = sseResponse([
      'event: tool_args\n',
      'data: {"id":"w1","name":"write","args":{"path":"test.md","content":"# Test"}}\n\n',
      'event: tool_args\n',
      'data: {"id":"e1","name":"edit","args":{"path":"test2.md"}}\n\n',
      'event: tool_end\n',
      'data: {"id":"w1","name":"write","result":"ok","isError":false}\n\n',
      'event: tool_end\n',
      'data: {"id":"e1","name":"edit","result":"ok","isError":false}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => false,
      isHearRepliesEnabled: () => true,
      onWriteStreaming,
      onEditStreaming,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(onWriteStreaming).not.toHaveBeenCalled()
    expect(onEditStreaming).not.toHaveBeenCalled()
  })

  it('handles tool_args with non-object args gracefully', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_args\n',
      'data: {"id":"t1","name":"write","args":null}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(messages[1].parts).toHaveLength(1)
    const p = messages[1].parts![0]
    if (p.type !== 'tool') throw new Error('expected tool')
    expect(p.toolCall.args).toEqual({})
  })

  it('handles tool_start with non-object args gracefully', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tool_start\n',
      'data: {"id":"t1","name":"search","args":"not an object"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(messages[1].parts).toHaveLength(1)
  })

  it('handles tts_chunk with missing b64 field', async () => {
    vi.mocked(playBrainTtsBlob).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tts_chunk\n',
      'data: {"id":"s1"}\n\n',
      'event: tts_done\n',
      'data: {"id":"s1","format":"mp3"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(playBrainTtsBlob)).not.toHaveBeenCalled()
  })

  it('handles tts_chunk with empty b64 string', async () => {
    vi.mocked(playBrainTtsBlob).mockClear()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', parts: [] },
    ]
    const res = sseResponse([
      'event: tts_chunk\n',
      'data: {"id":"s1","b64":""}\n\n',
      'event: tts_done\n',
      'data: {"id":"s1","format":"mp3"}\n\n',
    ])
    await consumeAgentChatStream(res, {
      getMessages: () => messages,
      msgIdx: 1,
      suppressAgentDetailAutoOpen: false,
      isActiveSession: () => true,
      isHearRepliesEnabled: () => true,
      setSessionId: () => {},
      setChatTitle: () => {},
      touchMessages: () => {},
      scrollToBottom: () => {},
    })
    expect(vi.mocked(playBrainTtsBlob)).not.toHaveBeenCalled()
  })
})
