import { describe, it, expect, vi, beforeEach } from 'vitest'
import ChatHistory from './ChatHistory.svelte'
import { render, screen, fireEvent, waitFor, within } from '@client/test/render.js'
import { fetchChatSessionListDeduped } from '@client/lib/chatHistorySessions.js'
import { loadNavHistory } from '@client/lib/navHistory.js'
import { apiFetch } from '@client/lib/apiFetch.js'
import { createChatSessionListItem } from '@client/test/fixtures/sessions.js'
import {
  chatHistoryTestProps,
  stubDeleteChatFetch,
} from '@client/test/helpers/index.js'

vi.mock('@client/lib/apiFetch.js', () => ({
  apiFetch: vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ tunnels: [] }), { status: 200 })),
  ),
}))

vi.mock('@client/lib/chatHistorySessions.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@client/lib/chatHistorySessions.js')>()
  return {
    ...mod,
    fetchChatSessionListDeduped: vi.fn(),
  }
})

vi.mock('@client/lib/navHistory.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@client/lib/navHistory.js')>()
  return {
    ...mod,
    loadNavHistory: vi.fn(),
    removeFromNavHistory: vi.fn().mockResolvedValue(undefined),
  }
})

const mockedFetchSessions = vi.mocked(fetchChatSessionListDeduped)
const mockedLoadNav = vi.mocked(loadNavHistory)
const mockedApiFetch = vi.mocked(apiFetch)

describe('ChatHistory.svelte', () => {
  beforeEach(() => {
    mockedLoadNav.mockResolvedValue([])
    mockedApiFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ tunnels: [] }), { status: 200 })),
    )
  })

  it('renders sessions from fetchChatSessionListDeduped', async () => {
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({ title: 'Alpha thread', sessionId: 's1' }),
    ])

    render(ChatHistory, {
      props: chatHistoryTestProps(),
    })

    await waitFor(() => {
      expect(screen.getByText('Alpha thread')).toBeInTheDocument()
    })
  })

  it('applies bg-surface-selected to the active chat row', async () => {
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({ sessionId: 'cur-session', title: 'Open chat' }),
    ])

    render(ChatHistory, {
      props: {
        ...chatHistoryTestProps(),
        activeSessionId: 'cur-session',
      },
    })

    await waitFor(() => {
      const row = screen.getByText('Open chat').closest('[role="button"]')
      expect(row).toBeTruthy()
      expect(row?.className).toMatch(/bg-surface-selected/)
    })
  })

  it('calls onSelect when a chat row is clicked', async () => {
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({ sessionId: 'abc', title: 'Pick me' }),
    ])

    const props = chatHistoryTestProps()
    render(ChatHistory, { props })

    const row = await screen.findByText('Pick me')
    await fireEvent.click(row.closest('[role="button"]')!)

    expect(props.onSelect).toHaveBeenCalledWith('abc', 'Pick me')
  })

  it('groups own, tunnels from grants API, and inbound chat sessions', async () => {
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({ sessionId: 'own', sessionType: 'own', title: 'Local chat' }),
      createChatSessionListItem({
        sessionId: 'inbound',
        sessionType: 'b2b_inbound',
        title: 'Fallback inbound title',
        remoteHandle: '@steven',
        remoteDisplayName: 'Steven Kean',
        remoteGrantId: 'grant-2',
        approvalState: 'pending',
      }),
    ])
    mockedApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tunnels: [
            {
              grantId: 'grant-1',
              ownerId: 'usr_own',
              ownerHandle: '@ken',
              ownerDisplayName: 'Ken Lay',
              sessionId: null,
            },
          ],
        }),
        { status: 200 },
      ),
    )

    render(ChatHistory, {
      props: chatHistoryTestProps(),
    })

    const chats = await screen.findByRole('heading', { name: /^chats$/i })
    const tunnels = screen.getByRole('heading', { name: /^tunnels$/i })
    const inbound = screen.getByRole('heading', { name: /inbound/i })

    expect(within(chats.closest('.ch-group--chats') as HTMLElement).getByText('Local chat')).toBeInTheDocument()
    expect(within(tunnels.closest('.ch-group--tunnels') as HTMLElement).getByText('Ken Lay')).toBeInTheDocument()
    const inboundSection = inbound.closest('.ch-group--inbound') as HTMLElement
    expect(within(inboundSection).getByText('Steven Kean')).toBeInTheDocument()
    expect(within(inboundSection).getByText('Pending')).toBeInTheDocument()
    expect(screen.queryByText('Fallback tunnel title')).not.toBeInTheDocument()
  })

  it('calls onNewChat when New chat is pressed', async () => {
    mockedFetchSessions.mockResolvedValue([])

    const props = chatHistoryTestProps()
    render(ChatHistory, { props })

    await fireEvent.click(await screen.findByRole('button', { name: /new chat/i }))
    expect(props.onNewChat).toHaveBeenCalled()
  })

  it('DELETEs session after confirm on trash', async () => {
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({ sessionId: 'del-me', title: 'Trash me' }),
    ])

    const del = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    stubDeleteChatFetch('del-me', del)

    const props = chatHistoryTestProps()
    render(ChatHistory, { props })

    await screen.findByText('Trash me')

    const deleteButtons = screen.getAllByRole('button', { name: /delete chat|remove from history/i })
    await fireEvent.click(deleteButtons[0]!)

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /delete chat/i })).toBeInTheDocument()
    })

    await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(del).toHaveBeenCalled()
    })
  })

  it('separates Chats from Recents with a distinct section landmark', async () => {
    mockedFetchSessions.mockResolvedValue([])

    render(ChatHistory, {
      props: {
        ...chatHistoryTestProps(),
        onWikiHome: vi.fn(),
      },
    })

    await screen.findByRole('heading', { name: /^chats$/i })
    const recentsHeading = screen.getByRole('heading', { name: /^recents$/i })
    const section = recentsHeading.closest('.ch-group--recents')
    expect(section).toBeTruthy()
    expect(section?.className).toMatch(/ch-group--recents/)
  })

  it('lists tunnels in alphabetical order by display label', async () => {
    mockedFetchSessions.mockResolvedValue([])
    mockedApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          tunnels: [
            {
              grantId: 'g-z',
              ownerId: 'usr_z',
              ownerHandle: 'z',
              ownerDisplayName: 'Zebra Peer',
              sessionId: null,
            },
            {
              grantId: 'g-a',
              ownerId: 'usr_a',
              ownerHandle: 'a',
              ownerDisplayName: 'Alpha Peer',
              sessionId: null,
            },
          ],
        }),
        { status: 200 },
      ),
    )

    render(ChatHistory, { props: chatHistoryTestProps() })

    const tunnelsHeading = await screen.findByRole('heading', { name: /^tunnels$/i })
    const section = tunnelsHeading.closest('.ch-group--tunnels') as HTMLElement
    const labels = within(section)
      .getAllByRole('button')
      .map((btn) => btn.textContent?.trim())
      .filter((t): t is string => !!t && t.includes('Peer'))
    expect(labels).toEqual(['Alpha Peer', 'Zebra Peer'])
  })

  it('opening a tunnel without a session POSTs ensure-session then selects', async () => {
    mockedFetchSessions.mockResolvedValue([])
    const props = chatHistoryTestProps()
    mockedApiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof Request ? input.url : input.pathname
      if (path.endsWith('/api/chat/b2b/tunnels')) {
        return new Response(
          JSON.stringify({
            tunnels: [
              {
                grantId: 'grant-open',
                ownerId: 'usr_o',
                ownerHandle: '@open',
                ownerDisplayName: 'Open Target',
                sessionId: null,
              },
            ],
          }),
          { status: 200 },
        )
      }
      if (path.endsWith('/api/chat/b2b/ensure-session')) {
        return new Response(JSON.stringify({ sessionId: 'sess-new-open' }), { status: 200 })
      }
      return new Response('not mocked', { status: 501 })
    })

    render(ChatHistory, { props })

    await screen.findByText('Open Target')
    await fireEvent.click(screen.getByText('Open Target').closest('[role="button"]')!)

    await waitFor(() => {
      expect(props.onSelect).toHaveBeenCalledWith('sess-new-open', 'Open Target')
      expect(mockedApiFetch.mock.calls.some((c) => String(c[0]).includes('/ensure-session'))).toBe(true)
    })
  })
})
