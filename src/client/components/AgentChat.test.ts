import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tick } from 'svelte'
import AgentChat from './AgentChat.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'
import {
  agentChatPostHandler,
  stubFetchForAgentChat,
} from '@client/test/helpers/index.js'
import { consumeAgentChatStream } from '@client/lib/agentStream.js'

vi.mock('./agent-conversation/AgentConversation.svelte', () => import('./test-stubs/AgentConversationStub.svelte'))
vi.mock('./ChatComposerAudio.svelte', () => import('./test-stubs/ChatComposerAudioStub.svelte'))
vi.mock('@client/lib/wikiFileListRefetch.js', () => ({
  registerWikiFileListRefetch: vi.fn(() => vi.fn()),
}))
vi.mock('@client/lib/brainTtsAudio.js', () => ({
  ensureBrainTtsAutoplayInUserGesture: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@client/lib/holdToSpeakMedia.js', () => ({
  requestMicrophonePermissionInUserGesture: vi.fn(),
}))

vi.mock('@client/lib/agentStream.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@client/lib/agentStream.js')>()
  return {
    ...mod,
    consumeAgentChatStream: vi.fn(),
  }
})

const mockedConsume = vi.mocked(consumeAgentChatStream)

describe('AgentChat.svelte', () => {
  beforeEach(() => {
    mockedConsume.mockResolvedValue({ sawDone: true, touchedWiki: false })
  })

  it('POSTs /api/chat when user sends after newChat', async () => {
    const post = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(new ReadableStream(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )

    stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

    const { component } = render(AgentChat, {
      props: {
        context: { type: 'none' },
      },
    })

    component.newChat({ skipOverlayClose: true })
    await tick()

    const ta = screen.getByRole('textbox')
    await fireEvent.input(ta, { target: { value: 'Hello agent' } })
    await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

    await waitFor(() => {
      expect(post).toHaveBeenCalled()
    })

    const first = post.mock.calls[0] as [string, RequestInit | undefined] | undefined
    const init = first?.[1]
    expect(init?.method).toBe('POST')
    const body = JSON.parse(String(init?.body)) as { message: string }
    expect(body.message).toBe('Hello agent')

    expect(mockedConsume).toHaveBeenCalled()
  })

  it('fetches wiki paths and skills on mount', async () => {
    const mockFetch = stubFetchForAgentChat({
      wikiList: [{ path: 'a.md', name: 'a' }],
    })

    render(AgentChat, {
      props: { context: { type: 'none' } },
    })

    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2)
    })
    expect(mockFetch.mock.calls.some((c) => String(c[0]) === '/api/wiki')).toBe(true)
    expect(mockFetch.mock.calls.some((c) => String(c[0]) === '/api/skills')).toBe(true)
  })
})
