import { describe, it, expect, vi, beforeEach } from 'vitest'
import ChatHistory from './ChatHistory.svelte'
import { render, screen, fireEvent, waitFor } from '@client/test/render.js'
import { fetchChatSessionListDeduped } from '@client/lib/chatHistorySessions.js'
import { loadNavHistory } from '@client/lib/navHistory.js'
import { createChatSessionListItem } from '@client/test/fixtures/sessions.js'
import {
  chatHistoryTestProps,
  stubDeleteChatFetch,
} from '@client/test/helpers/index.js'

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

describe('ChatHistory.svelte', () => {
  beforeEach(() => {
    mockedLoadNav.mockResolvedValue([])
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
})
