import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tick } from 'svelte'
import AgentChat from './AgentChat.svelte'
import { render, fireEvent, screen, waitFor, within } from '@client/test/render.js'
import {
  agentChatPostHandler,
  stubFetchForAgentChat,
} from '@client/test/helpers/index.js'
import { consumeAgentChatStream } from '@client/lib/agentStream.js'
import { jsonResponse, createMockFetch } from '@client/test/mocks/fetch.js'
vi.mock('./agent-conversation/AgentConversation.svelte', () => import('./test-stubs/AgentConversationStub.svelte'))
vi.mock('@client/lib/wikiFileListRefetch.js', () => ({
  registerWikiFileListRefetch: vi.fn(() => vi.fn()),
}))
vi.mock('@client/lib/brainTtsAudio.js', () => ({
  ensureBrainTtsAutoplayInUserGesture: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@client/lib/pressToTalkEnabled.js', () => ({
  isPressToTalkEnabled: vi.fn(() => false),
}))

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

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

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows composer new-chat and calls onUserInitiatedNewChat after a message exists', async () => {
    const post = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(new ReadableStream(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )

    stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

    const onUserInitiatedNewChat = vi.fn()
    const { component } = render(AgentChat, {
      props: {
        context: { type: 'none' },
        onUserInitiatedNewChat,
      },
    })

    component.newChat({ skipOverlayClose: true })
    await tick()

    const ta = screen.getByRole('textbox')
    await fireEvent.input(ta, { target: { value: 'Hi' } })
    await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'New chat' }))

    expect(onUserInitiatedNewChat).toHaveBeenCalledTimes(1)
  })

  it('hides composer new-chat when the thread is still empty', async () => {
    const onUserInitiatedNewChat = vi.fn()
    render(AgentChat, {
      props: { context: { type: 'none' }, onUserInitiatedNewChat },
    })
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument()
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

  describe('error handling', () => {
    it('displays error when POST returns non-OK status', async () => {
      const post = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 500, statusText: 'Server Error' })),
      )

      stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'fail message' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => {
        expect(post).toHaveBeenCalled()
      })
      await tick()

      expect(mockedConsume).not.toHaveBeenCalled()
    })

    it('handles fetch network error gracefully', async () => {
      const post = vi.fn(() => Promise.reject(new Error('Network failure')))

      stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'network error test' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => {
        expect(post).toHaveBeenCalled()
      })
      await tick()
    })
  })

  describe('session management', () => {
    it('loads existing session via loadSession', async () => {
      const sessionId = 'test-session-123'
      const sessionMessages = [
        { role: 'user' as const, content: 'previous message' },
        { role: 'assistant' as const, content: 'previous response' },
      ]

      const mock = createMockFetch([
        { match: (u: string) => u === '/api/wiki', response: () => jsonResponse([]) },
        { match: (u: string) => u === '/api/skills', response: () => jsonResponse([]) },
        {
          match: (u: string) => u.startsWith('/api/chat/sessions/'),
          response: () =>
            jsonResponse({
              sessionId,
              title: 'Previous Chat',
              messages: sessionMessages,
            }),
        },
      ])
      vi.stubGlobal('fetch', mock)

      const onSessionChange = vi.fn()
      const { component } = render(AgentChat, {
        props: { context: { type: 'none' }, onSessionChange },
      })

      await tick()
      await component.loadSession(sessionId)
      await tick()

      await waitFor(() => {
        const stub = screen.getByTestId('agent-conversation-stub')
        expect(within(stub).getByText(/previous message/)).toBeInTheDocument()
      })
    })

    it('shows error message when loadSession fails with non-OK status', async () => {
      const mock = createMockFetch([
        { match: (u: string) => u === '/api/wiki', response: () => jsonResponse([]) },
        { match: (u: string) => u === '/api/skills', response: () => jsonResponse([]) },
        {
          match: (u: string) => u.startsWith('/api/chat/sessions/'),
          response: () => new Response(null, { status: 404 }),
        },
      ])
      vi.stubGlobal('fetch', mock)

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      await tick()
      await component.loadSession('nonexistent-id')
      await tick()

      await waitFor(() => {
        const stub = screen.getByTestId('agent-conversation-stub')
        expect(within(stub).getByText(/Could not load chat/)).toBeInTheDocument()
      })
    })

    it('shows error message when loadSession throws', async () => {
      const mock = createMockFetch([
        { match: (u: string) => u === '/api/wiki', response: () => jsonResponse([]) },
        { match: (u: string) => u === '/api/skills', response: () => jsonResponse([]) },
        {
          match: (u: string) => u.startsWith('/api/chat/sessions/'),
          response: () => Promise.reject(new Error('Network error')),
        },
      ])
      vi.stubGlobal('fetch', mock)

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      await tick()
      await component.loadSession('error-id')
      await tick()

      await waitFor(() => {
        const stub = screen.getByTestId('agent-conversation-stub')
        expect(within(stub).getByText(/Could not load chat/)).toBeInTheDocument()
      })
    })

    it('newChat creates fresh session and calls onNewChat', async () => {
      stubFetchForAgentChat()

      const onNewChat = vi.fn()
      const { component } = render(AgentChat, {
        props: { context: { type: 'none' }, onNewChat },
      })

      await tick()
      component.newChat()
      await tick()

      expect(onNewChat).toHaveBeenCalled()
    })

    it('newChat with skipOverlayClose does not call onNewChat', async () => {
      stubFetchForAgentChat()

      const onNewChat = vi.fn()
      const { component } = render(AgentChat, {
        props: { context: { type: 'none' }, onNewChat },
      })

      await tick()
      component.newChat({ skipOverlayClose: true })
      await tick()

      expect(onNewChat).not.toHaveBeenCalled()
    })

    it('newChatWithMessage creates new chat and sends message', async () => {
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
        props: { context: { type: 'none' } },
      })

      await tick()
      await component.newChatWithMessage('auto message')
      await tick()

      await waitFor(() => {
        expect(post).toHaveBeenCalled()
      })

      const init = post.mock.calls[0]?.[1] as RequestInit
      const body = JSON.parse(String(init.body)) as { message: string }
      expect(body.message).toBe('auto message')
    })
  })

  describe('delete chat', () => {
    async function setupChatWithMessage() {
      const post = vi.fn(() =>
        Promise.resolve(
          new Response(new ReadableStream(), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      )

      const deleteFn = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))

      const mock = createMockFetch([
        { match: (u: string) => u === '/api/wiki', response: () => jsonResponse([]) },
        { match: (u: string) => u === '/api/skills', response: () => jsonResponse([]) },
        { match: (u, init) => u === '/api/chat' && init?.method === 'POST', response: post },
        { match: (u, init) => u.startsWith('/api/chat/') && init?.method === 'DELETE', response: deleteFn },
      ])
      vi.stubGlobal('fetch', mock)

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'test message' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => expect(post).toHaveBeenCalled())
      await tick()

      return { deleteFn }
    }

    it('shows delete button when messages exist', async () => {
      await setupChatWithMessage()

      const deleteBtn = screen.getByRole('button', { name: 'Delete chat' })
      expect(deleteBtn).toBeInTheDocument()
    })

    it('opens and cancels delete dialog', async () => {
      await setupChatWithMessage()

      const deleteBtn = screen.getByRole('button', { name: 'Delete chat' })
      await fireEvent.click(deleteBtn)
      await tick()

      expect(screen.getByText('Delete chat?')).toBeInTheDocument()

      const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
      await fireEvent.click(cancelBtn)
      await tick()

      expect(screen.queryByText('Delete chat?')).not.toBeInTheDocument()
    })
  })

  describe('hear replies toggle', () => {
    it('toggles hear replies from header button', async () => {
      const post = vi.fn(() =>
        Promise.resolve(
          new Response(new ReadableStream(), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      )

      stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'msg' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => expect(post).toHaveBeenCalled())
      await tick()

      const hearBtn = screen.getByRole('button', { name: /Assistant voice output/ })
      expect(hearBtn).toHaveAttribute('aria-pressed', 'false')

      await fireEvent.click(hearBtn)
      await tick()

      expect(hearBtn).toHaveAttribute('aria-pressed', 'true')

      await fireEvent.click(hearBtn)
      await tick()

      expect(hearBtn).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('context chips', () => {
    async function sendMessageToShowHeader(context: { type: string; [key: string]: unknown }) {
      const post = vi.fn(() =>
        Promise.resolve(
          new Response(new ReadableStream(), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      )

      stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

      const { component } = render(AgentChat, {
        props: { context: context as Parameters<typeof render>[1]['props']['context'] },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'msg' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => expect(post).toHaveBeenCalled())
      await tick()
    }

    it('displays email context chip', async () => {
      await sendMessageToShowHeader({ type: 'email', threadId: 't1', subject: 'Test Subject' })
      expect(screen.getByText(/Test Subject/)).toBeInTheDocument()
    })

    it('displays calendar context chip', async () => {
      await sendMessageToShowHeader({ type: 'calendar', date: '2024-03-15' })
      expect(screen.getByText(/2024-03-15/)).toBeInTheDocument()
    })

    it('displays inbox context chip', async () => {
      await sendMessageToShowHeader({ type: 'inbox' })
      expect(screen.getByText(/Inbox/)).toBeInTheDocument()
    })

    it('displays messages context chip', async () => {
      await sendMessageToShowHeader({ type: 'messages', canonicalChat: '+1234567890', displayLabel: 'John Doe' })
      expect(screen.getByText(/John Doe/)).toBeInTheDocument()
    })

    it('hides context chip when hidePaneContextChip is true', async () => {
      const post = vi.fn(() =>
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
          context: { type: 'inbox' },
          hidePaneContextChip: true,
        },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'msg' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => expect(post).toHaveBeenCalled())
      await tick()

      expect(screen.queryByText(/📥 Inbox/)).not.toBeInTheDocument()
    })
  })

  describe('stop chat', () => {
    it('aborts streaming when stop is triggered', async () => {
      let resolvePost: () => void
      const postPromise = new Promise<Response>((resolve) => {
        resolvePost = () =>
          resolve(
            new Response(new ReadableStream(), {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            }),
          )
      })
      const post = vi.fn(() => postPromise)

      stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

      let abortCalled = false
      mockedConsume.mockImplementation(async () => {
        await new Promise<void>((_, reject) => {
          setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 1000)
        })
        return { sawDone: false, touchedWiki: false }
      })

      const onStreamingChange = vi.fn()
      const { component } = render(AgentChat, {
        props: { context: { type: 'none' }, onStreamingChange },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'long running' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => expect(post).toHaveBeenCalled())
      resolvePost!()
      await tick()

      await waitFor(() => expect(onStreamingChange).toHaveBeenCalledWith(true))
    })
  })

  describe('appendToComposer', () => {
    it('appends text to composer via public method', async () => {
      stubFetchForAgentChat()

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      component.appendToComposer('@wiki.md')
      await tick()

      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      expect(ta.value).toContain('@wiki.md')
    })
  })

  describe('focusComposer', () => {
    it('focuses composer via public method', async () => {
      stubFetchForAgentChat()

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      component.focusComposer()
      await tick()

      const ta = screen.getByRole('textbox')
      expect(document.activeElement).toBe(ta)
    })
  })

  describe('callbacks', () => {
    it('calls onUserSendMessage when sending', async () => {
      const post = vi.fn(() =>
        Promise.resolve(
          new Response(new ReadableStream(), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      )

      stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

      const onUserSendMessage = vi.fn()
      const { component } = render(AgentChat, {
        props: { context: { type: 'none' }, onUserSendMessage },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'callback test' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => {
        expect(onUserSendMessage).toHaveBeenCalled()
      })
    })

    it('calls onChatPersisted after stream finishes', async () => {
      const post = vi.fn(() =>
        Promise.resolve(
          new Response(new ReadableStream(), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      )

      stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

      const onChatPersisted = vi.fn()
      const { component } = render(AgentChat, {
        props: { context: { type: 'none' }, onChatPersisted },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'persist test' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => {
        expect(onChatPersisted).toHaveBeenCalled()
      })
    })

    it('calls onStreamFinished when done event is received', async () => {
      const post = vi.fn(() =>
        Promise.resolve(
          new Response(new ReadableStream(), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      )

      stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

      const onStreamFinished = vi.fn()
      const { component } = render(AgentChat, {
        props: { context: { type: 'none' }, onStreamFinished },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'finish test' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => {
        expect(onStreamFinished).toHaveBeenCalled()
      })
    })
  })

  describe('autoSendMessage', () => {
    it('automatically sends message on mount when autoSendMessage is set', async () => {
      const post = vi.fn((_url: string, _init?: RequestInit) =>
        Promise.resolve(
          new Response(new ReadableStream(), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      )

      stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

      render(AgentChat, {
        props: {
          context: { type: 'none' },
          autoSendMessage: 'auto kickoff message',
        },
      })

      await waitFor(() => {
        expect(post).toHaveBeenCalled()
      })

      const init = post.mock.calls[0]?.[1] as RequestInit
      const body = JSON.parse(String(init.body)) as { message: string }
      expect(body.message).toBe('auto kickoff message')
    })
  })

  describe('hideInput prop', () => {
    it('hides composer when hideInput is true', async () => {
      stubFetchForAgentChat()

      render(AgentChat, {
        props: {
          context: { type: 'none' },
          hideInput: true,
        },
      })

      await tick()

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  describe('custom headerFallbackTitle', () => {
    it('uses custom fallback title', async () => {
      const post = vi.fn(() =>
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
          headerFallbackTitle: 'Custom Title',
        },
      })

      component.newChat({ skipOverlayClose: true })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'msg' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => expect(post).toHaveBeenCalled())
      await tick()

      expect(screen.getByText('Custom Title')).toBeInTheDocument()
    })
  })

  describe('voice panel layout (source contract)', () => {
    it('voice eligibility follows press-to-talk only (not viewport width)', () => {
      const path = join(dirname(fileURLToPath(import.meta.url)), 'AgentChat.svelte')
      const src = readFileSync(path, 'utf8')
      expect(src).toContain(
        'const voiceComposerEligible = $derived(pressToTalkUiEnabled)',
      )
      expect(src).not.toContain('isMobileViewport && !bridgeSlideLayout')
    })

    it('composes voice + text through UnifiedChatComposer (no stacked voice above input or voice dock padding)', () => {
      const path = join(dirname(fileURLToPath(import.meta.url)), 'AgentChat.svelte')
      const src = readFileSync(path, 'utf8')
      expect(src).toContain('<UnifiedChatComposer')
      expect(src).not.toContain('<ChatVoicePanel')
      expect(src).not.toContain('composer-stack--voice-panel')
      const contextIdx = src.indexOf('<ComposerContextBar')
      const unifiedIdx = src.indexOf('<UnifiedChatComposer')
      expect(contextIdx).toBeGreaterThan(-1)
      expect(unifiedIdx).toBeGreaterThan(contextIdx)
      const unifiedPath = join(dirname(path), 'UnifiedChatComposer.svelte')
      const unifiedSrc = readFileSync(unifiedPath, 'utf8')
      expect(unifiedSrc).toContain('layout="composer-flow"')
      expect(unifiedSrc).toContain('<ChatVoicePanel')
      expect(unifiedSrc).toContain('<AgentInput')
    })
  })
})
