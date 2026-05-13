import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tick } from 'svelte'
import AgentChat from './AgentChat.svelte'
import AgentChatWikiBridgeHarness from './test-stubs/AgentChatWikiBridgeHarness.svelte'
import { render, fireEvent, screen, waitFor, within } from '@client/test/render.js'
import {
  agentChatPostHandler,
  stubFetchForAgentChat,
} from '@client/test/helpers/index.js'
import { consumeAgentChatStream } from '@client/lib/agentStream.js'
import { jsonResponse, createMockFetch } from '@client/test/mocks/fetch.js'
import * as router from '@client/router.js'
vi.mock('./agent-conversation/AgentConversation.svelte', () => import('./test-stubs/AgentConversationStub.svelte'))
vi.mock('@client/lib/wikiFileListRefetch.js', () => ({
  registerWikiFileListRefetch: vi.fn(() => vi.fn()),
}))
vi.mock('@client/lib/brainTtsAudio.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@client/lib/brainTtsAudio.js')>()
  return {
    ...mod,
    ensureBrainTtsAutoplayInUserGesture: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('@client/lib/pressToTalkEnabled.js', () => ({
  isPressToTalkEnabled: vi.fn(() => false),
}))

const hubNotifSubscribersTest = vi.hoisted(() => ({
  cbs: [] as Array<() => void>,
}))

vi.mock('@client/lib/hubEvents/hubEventsClient.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@client/lib/hubEvents/hubEventsClient.js')>()
  return {
    ...mod,
    subscribeHubNotificationsRefresh: vi.fn((cb: () => void) => {
      hubNotifSubscribersTest.cbs.push(cb)
      return () => {
        const i = hubNotifSubscribersTest.cbs.indexOf(cb)
        if (i >= 0) hubNotifSubscribersTest.cbs.splice(i, 1)
      }
    }),
  }
})

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
  it('getShellRoutingEmptyDetailState is empty and not streaming for initial pending session', async () => {
    const { component } = render(AgentChat, {
      props: { context: { type: 'none' } },
    })
    await tick()
    expect(component.getShellRoutingEmptyDetailState()).toEqual({
      transcriptEmpty: true,
      streaming: false,
    })
  })

  beforeEach(() => {
    mockedConsume.mockResolvedValue({
      sawDone: true,
      touchedWiki: false,
      deferredFinishConversation: false,
    })
    hubNotifSubscribersTest.cbs.length = 0
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

  it('calls onAgentFinishConversation after stream when set; does not call onUserInitiatedNewChat', async () => {
    const post = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(new ReadableStream(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )
    stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })

    const onAgentFinishConversation = vi.fn()
    const onUserInitiatedNewChat = vi.fn()
    mockedConsume.mockImplementation(async (_res, opts) => {
      await Promise.resolve(opts.onFinishConversation?.())
      return { sawDone: true, touchedWiki: false, deferredFinishConversation: false }
    })

    const { component } = render(AgentChat, {
      props: {
        context: { type: 'none' },
        onAgentFinishConversation,
        onUserInitiatedNewChat,
      },
    })
    component.newChat({ skipOverlayClose: true })
    await tick()
    const ta = screen.getByRole('textbox')
    await fireEvent.input(ta, { target: { value: 'Hi' } })
    await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })
    await waitFor(() => expect(mockedConsume).toHaveBeenCalled())

    expect(onAgentFinishConversation).toHaveBeenCalledTimes(1)
    expect(onUserInitiatedNewChat).not.toHaveBeenCalled()
  })

  it('falls back to onUserInitiatedNewChat after stream when onAgentFinishConversation unset', async () => {
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
    mockedConsume.mockImplementation(async (_res, opts) => {
      await Promise.resolve(opts.onFinishConversation?.())
      return { sawDone: true, touchedWiki: false, deferredFinishConversation: false }
    })

    const { component } = render(AgentChat, {
      props: { context: { type: 'none' }, onUserInitiatedNewChat },
    })
    component.newChat({ skipOverlayClose: true })
    await tick()
    const ta = screen.getByRole('textbox')
    await fireEvent.input(ta, { target: { value: 'Hi' } })
    await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })
    await waitFor(() => expect(mockedConsume).toHaveBeenCalled())

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

  it('empty-chat notification strip POSTs short message and notificationKickoff; PATCH read on finish', async () => {
    const chatPost = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(new ReadableStream(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )
    const patchNotif = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ ok: true })),
    )

    stubFetchForAgentChat({
      extra: [
        agentChatPostHandler(chatPost),
        {
          match: (u: string) => u.startsWith('/api/notifications?') && u.includes('state=unread'),
          response: () =>
            jsonResponse([
              {
                id: 'n1',
                sourceKind: 'mail_notify',
                payload: { messageId: 'mid-a', subject: 'Subj' },
              },
            ]),
        },
        {
          match: (u: string, init?: RequestInit) =>
            u === '/api/notifications/n1' && init?.method === 'PATCH',
          response: patchNotif,
        },
      ],
    })

    mockedConsume.mockImplementation(async (_res, opts) => {
      await Promise.resolve(opts.onFinishConversation?.())
      return { sawDone: true, touchedWiki: false, deferredFinishConversation: false }
    })

    const { component } = render(AgentChat, {
      props: {
        context: { type: 'none' },
        showEmptyChatNotifications: true,
      },
    })
    component.newChat({ skipOverlayClose: true })
    await tick()

    await waitFor(() => {
      expect(screen.getByTestId('empty-chat-notifications-strip')).toBeInTheDocument()
    })

    await fireEvent.click(screen.getByTestId('empty-chat-notif-act'))

    await waitFor(() => expect(chatPost).toHaveBeenCalled())
    const first = chatPost.mock.calls[0] as [string, RequestInit | undefined] | undefined
    const init = first?.[1]
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      message: string
      notificationKickoff?: Record<string, string>
    }
    expect(body.message).toContain('Summarize')
    expect(body.message).not.toContain('n1')
    expect(body.message).not.toContain('mid-a')
    expect(body.notificationKickoff).toEqual({
      notificationId: 'n1',
      sourceKind: 'mail_notify',
      messageId: 'mid-a',
      subject: 'Subj',
    })

    await waitFor(() => expect(patchNotif).toHaveBeenCalled())
    const patchInit = patchNotif.mock.calls[0]?.[1] as RequestInit | undefined
    expect(JSON.parse(String(patchInit?.body ?? '{}'))).toEqual({ state: 'read' })
  })

  it('empty-chat b2b_inbound_query navigates to Review zone and does not POST main assistant chat', async () => {
    const chatPost = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(new ReadableStream(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )
    const patchNotif = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ ok: true })),
    )
    const onSelectChatSession = vi.fn().mockResolvedValue(undefined)
    const navigateSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {})

    stubFetchForAgentChat({
      extra: [
        agentChatPostHandler(chatPost),
        {
          match: (u: string) => u.startsWith('/api/notifications?') && u.includes('state=unread'),
          response: () =>
            jsonResponse([
              {
                id: 'nin',
                sourceKind: 'b2b_inbound_query',
                payload: {
                  grantId: 'bqg_t',
                  b2bSessionId: 'in-sess-1',
                  peerHandle: 'asker',
                  question: 'Hi?',
                },
              },
            ]),
        },
        {
          match: (u: string, init?: RequestInit) =>
            u === '/api/notifications/nin' && init?.method === 'PATCH',
          response: patchNotif,
        },
      ],
    })

    const { component } = render(AgentChat, {
      props: {
        context: { type: 'none' },
        showEmptyChatNotifications: true,
        onSelectChatSession,
      },
    })
    component.newChat({ skipOverlayClose: true })
    await tick()

    await waitFor(() => {
      expect(screen.getByTestId('empty-chat-notifications-strip')).toBeInTheDocument()
    })

    await fireEvent.click(screen.getByTestId('empty-chat-notif-act'))

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith({ zone: 'review', reviewSessionId: 'in-sess-1' })
    })
    expect(onSelectChatSession).not.toHaveBeenCalled()
    expect(chatPost).not.toHaveBeenCalled()
    await waitFor(() => expect(patchNotif).toHaveBeenCalled())
    navigateSpy.mockRestore()
  })

  it('empty-chat brain_query_grant_received ensures tunnel and POSTs b2b welcome, not main chat', async () => {
    const mainChatPost = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(new ReadableStream(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )
    const b2bSend = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(new ReadableStream(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )
    const patchNotif = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ ok: true })),
    )
    const outSessionId = 'outbound-grant-sess'

    let agent: InstanceType<typeof AgentChat>
    const onSelectChatSession = vi.fn(async (sid: string) => {
      await agent.loadSession(sid)
    })

    const { component } = render(AgentChat, {
      props: {
        context: { type: 'none' },
        showEmptyChatNotifications: true,
        onSelectChatSession,
      },
    })
    agent = component

    const mock = createMockFetch([
      { match: (u: string) => u === '/api/wiki', response: () => jsonResponse([]) },
      { match: (u: string) => u === '/api/skills', response: () => jsonResponse([]) },
      {
        match: (u: string) => u === '/api/chat/b2b/tunnels',
        response: () => jsonResponse({ tunnels: [] }),
      },
      {
        match: (u: string, init?: RequestInit) =>
          u === '/api/chat/b2b/ensure-session' && init?.method === 'POST',
        response: () => jsonResponse({ sessionId: outSessionId }),
      },
      {
        match: (u: string) => u === `/api/chat/sessions/${encodeURIComponent(outSessionId)}`,
        response: () =>
          jsonResponse({
            sessionId: outSessionId,
            title: null,
            sessionType: 'b2b_outbound',
            remoteGrantId: 'bqg_grant_a',
            remoteHandle: '@owner',
            remoteDisplayName: 'Owner',
            approvalState: null,
            messages: [],
          }),
      },
      {
        match: (u: string) => u.startsWith('/api/notifications?') && u.includes('state=unread'),
        response: () =>
          jsonResponse([
            {
              id: 'gnot',
              sourceKind: 'brain_query_grant_received',
              payload: {
                grantId: 'bqg_grant_a',
                ownerHandle: 'owner',
                ownerId: 'usr_o',
              },
            },
          ]),
      },
      {
        match: (u: string, init?: RequestInit) =>
          u === '/api/notifications/gnot' && init?.method === 'PATCH',
        response: patchNotif,
      },
      {
        match: (u: string, init?: RequestInit) => u === '/api/chat' && init?.method === 'POST',
        response: mainChatPost,
      },
      {
        match: (u: string, init?: RequestInit) =>
          u === '/api/chat/b2b/send' && init?.method === 'POST',
        response: b2bSend,
      },
    ])
    vi.stubGlobal('fetch', mock)

    agent.newChat({ skipOverlayClose: true })
    await tick()

    await waitFor(() => {
      expect(screen.getByTestId('empty-chat-notifications-strip')).toBeInTheDocument()
    })

    mockedConsume.mockImplementation(async (_res, opts) => {
      await Promise.resolve(opts.onFinishConversation?.())
      return { sawDone: true, touchedWiki: false, deferredFinishConversation: false }
    })

    await fireEvent.click(screen.getByTestId('empty-chat-notif-act'))

    await waitFor(() => expect(onSelectChatSession).toHaveBeenCalledWith(outSessionId, expect.any(String)))
    await waitFor(() => expect(b2bSend).toHaveBeenCalled())
    expect(mainChatPost).not.toHaveBeenCalled()
    const b2bInit = b2bSend.mock.calls[0]?.[1] as RequestInit | undefined
    const b2bBody = JSON.parse(String(b2bInit?.body ?? '{}')) as { message?: string; grantId?: string }
    expect(b2bBody.grantId).toBe('bqg_grant_a')
    expect(b2bBody.message?.length ?? 0).toBeGreaterThan(0)
    await waitFor(() => expect(patchNotif).toHaveBeenCalled())
  })

  it('notification strip flow does not PATCH read when finish hook does not run', async () => {
    const chatPost = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(new ReadableStream(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      ),
    )
    const patchNotif = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })))

    stubFetchForAgentChat({
      extra: [
        agentChatPostHandler(chatPost),
        {
          match: (u: string) => u.startsWith('/api/notifications?') && u.includes('state=unread'),
          response: () =>
            jsonResponse([
              {
                id: 'n1',
                sourceKind: 'mail_notify',
                payload: { subject: 'S' },
              },
            ]),
        },
        {
          match: (u: string, init?: RequestInit) =>
            u.startsWith('/api/notifications/') && init?.method === 'PATCH',
          response: patchNotif,
        },
      ],
    })

    mockedConsume.mockResolvedValue({
      sawDone: true,
      touchedWiki: false,
      deferredFinishConversation: false,
    })

    const { component } = render(AgentChat, {
      props: { context: { type: 'none' }, showEmptyChatNotifications: true },
    })
    component.newChat({ skipOverlayClose: true })
    await tick()
    await waitFor(() => expect(screen.getByTestId('empty-chat-notifications-strip')).toBeInTheDocument())
    await fireEvent.click(screen.getByTestId('empty-chat-notif-act'))
    await waitFor(() => expect(chatPost).toHaveBeenCalled())
    expect(patchNotif).not.toHaveBeenCalled()
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

    it('shows B2B identity in the header for outbound sessions', async () => {
      const sessionId = 'outbound-session-123'
      const mock = createMockFetch([
        { match: (u: string) => u === '/api/wiki', response: () => jsonResponse([]) },
        { match: (u: string) => u === '/api/skills', response: () => jsonResponse([]) },
        {
          match: (u: string) => u.startsWith('/api/chat/sessions/'),
          response: () =>
            jsonResponse({
              sessionId,
              title: null,
              sessionType: 'b2b_outbound',
              remoteGrantId: 'grant-1',
              remoteHandle: '@ken',
              remoteDisplayName: 'Ken Lay',
              approvalState: null,
              messages: [
                { role: 'user', content: 'previous message' },
                { role: 'assistant', content: 'previous response' },
              ],
            }),
        },
      ])
      vi.stubGlobal('fetch', mock)

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      await tick()
      await component.loadSession(sessionId)

      await waitFor(() => {
        expect(screen.getByText('Ken Lay')).toBeInTheDocument()
        expect(screen.getByText('via tunnel')).toBeInTheDocument()
      })
    })

    it('enables tunnel save-to-wiki UI only for outbound b2b sessions', async () => {
      const sessionId = 'outbound-session-wiki-ui'
      const mock = createMockFetch([
        { match: (u: string) => u === '/api/wiki', response: () => jsonResponse([]) },
        { match: (u: string) => u === '/api/skills', response: () => jsonResponse([]) },
        {
          match: (u: string) => u.startsWith('/api/chat/sessions/'),
          response: () =>
            jsonResponse({
              sessionId,
              title: null,
              sessionType: 'b2b_outbound',
              remoteGrantId: 'grant-1',
              remoteHandle: '@ken',
              remoteDisplayName: 'Ken Lay',
              approvalState: null,
              messages: [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hey' },
              ],
            }),
        },
      ])
      vi.stubGlobal('fetch', mock)

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      await tick()
      await component.loadSession(sessionId)

      await waitFor(() => {
        const stub = screen.getByTestId('agent-conversation-stub')
        expect(stub).toHaveAttribute('data-tunnel-wiki', '1')
      })
      expect(screen.getByTestId('tunnel-wiki-select-mode')).toBeInTheDocument()
    })

    it('does not show tunnel save-to-wiki controls for own chat sessions', async () => {
      const sessionId = 'own-session-nowiki'
      const mock = createMockFetch([
        { match: (u: string) => u === '/api/wiki', response: () => jsonResponse([]) },
        { match: (u: string) => u === '/api/skills', response: () => jsonResponse([]) },
        {
          match: (u: string) => u.startsWith('/api/chat/sessions/'),
          response: () =>
            jsonResponse({
              sessionId,
              title: 'Me',
              sessionType: 'own',
              messages: [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'hey' },
              ],
            }),
        },
      ])
      vi.stubGlobal('fetch', mock)

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      await tick()
      await component.loadSession(sessionId)

      await waitFor(() => {
        expect(screen.getByTestId('agent-conversation-stub')).toHaveAttribute('data-tunnel-wiki', '0')
      })
      expect(screen.queryByTestId('tunnel-wiki-select-mode')).not.toBeInTheDocument()
    })

    it('uses tunnel outbound composer placeholder when outbound session transcript is empty', async () => {
      const sessionId = 'outbound-empty-session'
      const mock = createMockFetch([
        { match: (u: string) => u === '/api/wiki', response: () => jsonResponse([]) },
        { match: (u: string) => u === '/api/skills', response: () => jsonResponse([]) },
        {
          match: (u: string) => u.startsWith('/api/chat/sessions/'),
          response: () =>
            jsonResponse({
              sessionId,
              title: null,
              sessionType: 'b2b_outbound',
              remoteGrantId: 'grant-empty',
              remoteHandle: '@ken',
              remoteDisplayName: 'Ken Lay',
              approvalState: null,
              messages: [],
            }),
        },
      ])
      vi.stubGlobal('fetch', mock)

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      await tick()
      await component.loadSession(sessionId)
      await tick()

      const ta = await screen.findByRole('textbox')
      expect(ta).toHaveAttribute('placeholder', '@ken…')
    })

    it('posts outbound tunnel messages to the B2B send endpoint', async () => {
      const sessionId = 'outbound-session-456'
      const post = vi.fn((_url: string, _init?: RequestInit) =>
        Promise.resolve(
          new Response(new ReadableStream(), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      )
      const mock = createMockFetch([
        { match: (u: string) => u === '/api/wiki', response: () => jsonResponse([]) },
        { match: (u: string) => u === '/api/skills', response: () => jsonResponse([]) },
        {
          match: (u: string) => u.startsWith('/api/chat/sessions/'),
          response: () =>
            jsonResponse({
              sessionId,
              title: null,
              sessionType: 'b2b_outbound',
              remoteGrantId: 'grant-send',
              remoteHandle: '@ken',
              remoteDisplayName: 'Ken Lay',
              approvalState: null,
              messages: [
                { role: 'user', content: 'previous message' },
                { role: 'assistant', content: 'previous response' },
              ],
            }),
        },
        {
          match: (u: string, init?: RequestInit) =>
            u === '/api/chat/b2b/send' && init?.method === 'POST',
          response: post,
        },
      ])
      vi.stubGlobal('fetch', mock)

      const { component } = render(AgentChat, {
        props: { context: { type: 'none' } },
      })

      await tick()
      await component.loadSession(sessionId)
      const ta = await screen.findByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'Ask the tunnel' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => expect(post).toHaveBeenCalled())
      const init = post.mock.calls[0]?.[1] as RequestInit
      expect(JSON.parse(String(init.body))).toMatchObject({
        grantId: 'grant-send',
        message: 'Ask the tunnel',
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
        return { sawDone: false, touchedWiki: false, deferredFinishConversation: false }
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

    it('does not re-invoke onHearRepliesChange when only the callback reference changes', async () => {
      stubFetchForAgentChat()

      const first = vi.fn()
      const second = vi.fn()
      const { rerender } = render(AgentChat, {
        props: { context: { type: 'none' }, onHearRepliesChange: first },
      })
      await tick()
      const n = first.mock.calls.length
      expect(n).toBeGreaterThanOrEqual(1)

      rerender({
        props: { context: { type: 'none' }, onHearRepliesChange: second },
      })
      await tick()

      expect(first.mock.calls.length).toBe(n)
      expect(second.mock.calls.length).toBe(0)
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

  describe('mobile audio conversation toggle (empty chat)', () => {
    beforeEach(() => {
      localStorage.clear()
    })

    it('renders the audio conversation toggle when chat is empty', async () => {
      stubFetchForAgentChat()
      render(AgentChat, { props: { context: { type: 'none' } } })
      await tick()
      expect(screen.getByRole('switch', { name: /audio conversation/i })).toBeInTheDocument()
    })

    it('does not render audio conversation toggle in wiki mobile bridge overlay (empty thread)', async () => {
      stubFetchForAgentChat()
      render(AgentChatWikiBridgeHarness)
      await tick()
      expect(screen.getByTestId('wiki-bridge-overlay-stub')).toBeInTheDocument()
      expect(screen.queryByRole('switch', { name: /audio conversation/i })).not.toBeInTheDocument()
    })

    it('toggle is not rendered once messages exist', async () => {
      const post = vi.fn(() =>
        Promise.resolve(
          new Response(new ReadableStream(), {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
      )
      stubFetchForAgentChat({ extra: [agentChatPostHandler(post)] })
      render(AgentChat, { props: { context: { type: 'none' }, onUserInitiatedNewChat: vi.fn() } })
      await tick()

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'Hi' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      await waitFor(() => expect(post).toHaveBeenCalled())
      await tick()

      expect(screen.queryByRole('switch', { name: /audio conversation/i })).not.toBeInTheDocument()
    })

    it('toggle starts unchecked (hearReplies off by default)', async () => {
      stubFetchForAgentChat()
      render(AgentChat, { props: { context: { type: 'none' } } })
      await tick()
      const toggle = screen.getByRole('switch', { name: /audio conversation/i })
      expect(toggle.getAttribute('aria-checked')).toBe('false')
    })

    it('clicking the toggle turns hearReplies on (aria-checked becomes true)', async () => {
      stubFetchForAgentChat()
      render(AgentChat, { props: { context: { type: 'none' } } })
      await tick()
      const toggle = screen.getByRole('switch', { name: /audio conversation/i })
      await fireEvent.click(toggle)
      await tick()
      expect(toggle.getAttribute('aria-checked')).toBe('true')
    })

    it('clicking the toggle twice returns hearReplies to off', async () => {
      stubFetchForAgentChat()
      render(AgentChat, { props: { context: { type: 'none' } } })
      await tick()
      const toggle = screen.getByRole('switch', { name: /audio conversation/i })
      await fireEvent.click(toggle)
      await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
      await fireEvent.click(toggle)
      await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
    })
  })

  describe('empty-chat notifications', () => {
    it('refetches strip when hub notifications refresh callback runs', async () => {
      const apiRow = {
        id: 'nid-1',
        sourceKind: 'mail_notify',
        payload: { messageId: 'mid@x', subject: 'Ping' },
        state: 'unread',
        idempotencyKey: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      }
      let getCount = 0
      stubFetchForAgentChat({
        extra: [
          {
            match: (u: string) => u.startsWith('/api/notifications?'),
            response: () => {
              getCount++
              return jsonResponse(getCount >= 2 ? [] : [apiRow])
            },
          },
        ],
      })
      render(AgentChat, { props: { context: { type: 'none' } } })
      await waitFor(() => {
        expect(screen.getByTestId('empty-chat-notif-act')).toHaveTextContent('Ping')
      })
      expect(getCount).toBe(1)
      expect(hubNotifSubscribersTest.cbs.length).toBe(1)
      hubNotifSubscribersTest.cbs[0]!()
      await waitFor(() => {
        expect(screen.queryByTestId('empty-chat-notifications-strip')).not.toBeInTheDocument()
      })
      expect(getCount).toBe(2)
    })

    it('fetches unread strip when thread is empty', async () => {
      const apiRow = {
        id: 'nid-1',
        sourceKind: 'mail_notify',
        payload: { messageId: 'mid@x', subject: 'Ping' },
        state: 'unread',
        idempotencyKey: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      }
      stubFetchForAgentChat({
        extra: [
          {
            match: (u: string) => u.startsWith('/api/notifications?'),
            response: () => jsonResponse([apiRow]),
          },
        ],
      })
      render(AgentChat, { props: { context: { type: 'none' } } })
      await waitFor(() => {
        expect(screen.getByTestId('empty-chat-notif-act')).toHaveTextContent('Ping')
      })
    })

    it('caps rows at three and shows overflow', async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({
        id: `id-${i}`,
        sourceKind: 'mail_notify',
        payload: { messageId: `m${i}`, subject: `S${i}` },
        state: 'unread',
        idempotencyKey: null,
        createdAtMs: i,
        updatedAtMs: i,
      }))
      stubFetchForAgentChat({
        extra: [
          {
            match: (u: string) => u.startsWith('/api/notifications?'),
            response: () => jsonResponse(rows),
          },
        ],
      })
      render(AgentChat, { props: { context: { type: 'none' } } })
      await waitFor(() => {
        expect(screen.getAllByTestId('empty-chat-notif-act')).toHaveLength(3)
      })
      expect(screen.getByTestId('empty-chat-notif-overflow')).toBeInTheDocument()
    })

    it('dismiss triggers PATCH then refetches empty list', async () => {
      const apiRow = {
        id: 'to-dismiss',
        sourceKind: 'mail_notify',
        payload: { messageId: 'm', subject: 'X' },
        state: 'unread',
        idempotencyKey: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      }
      let getCount = 0
      const patchSpy = vi.fn(() => jsonResponse({ ...apiRow, state: 'dismissed' }))
      stubFetchForAgentChat({
        extra: [
          {
            match: (u: string, init?: RequestInit) =>
              u.startsWith('/api/notifications?') && (!init?.method || init.method === 'GET'),
            response: () => {
              getCount++
              return jsonResponse(getCount >= 2 ? [] : [apiRow])
            },
          },
          {
            match: (u: string, init?: RequestInit) =>
              init?.method === 'PATCH' && u.includes('/api/notifications/to-dismiss'),
            response: patchSpy,
          },
        ],
      })
      render(AgentChat, { props: { context: { type: 'none' } } })
      await waitFor(() => expect(screen.getByTestId('empty-chat-notif-dismiss')).toBeInTheDocument())
      await fireEvent.click(screen.getByTestId('empty-chat-notif-dismiss'))
      await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1))
      await waitFor(() => {
        expect(screen.queryByTestId('empty-chat-notifications-strip')).not.toBeInTheDocument()
      })
    })
  })

  describe('composer horizontal inset (source contract)', () => {
    it('composer-stack shares transcript horizontal padding token', () => {
      const path = join(dirname(fileURLToPath(import.meta.url)), 'AgentChat.svelte')
      const src = readFileSync(path, 'utf8')
      expect(src).toContain('composer-stack relative box-border')
      expect(src).toContain('px-[length:var(--chat-transcript-px)]')
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
