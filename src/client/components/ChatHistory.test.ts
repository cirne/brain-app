import { describe, it, expect, vi, beforeEach } from 'vitest'
import ChatHistory from './ChatHistory.svelte'
import { B2B_TUNNEL_AWAITING_PEER_PREVIEW_SNIPPET } from '@shared/b2bTunnelDelivery.js'
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

const hubTunnelSubs = vi.hoisted(() => ({ cbs: [] as Array<(p: unknown) => void> }))
const hubNotifRefreshSubs = vi.hoisted(() => ({ cbs: [] as Array<() => void> }))

vi.mock('@client/lib/hubEvents/hubEventsClient.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@client/lib/hubEvents/hubEventsClient.js')>()
  return {
    ...mod,
    subscribeTunnelActivity: vi.fn((cb: (p: unknown) => void) => {
      hubTunnelSubs.cbs.push(cb)
      return () => {
        const i = hubTunnelSubs.cbs.indexOf(cb)
        if (i >= 0) hubTunnelSubs.cbs.splice(i, 1)
      }
    }),
    subscribeHubNotificationsRefresh: vi.fn((cb: () => void) => {
      hubNotifRefreshSubs.cbs.push(cb)
      return () => {
        const i = hubNotifRefreshSubs.cbs.indexOf(cb)
        if (i >= 0) hubNotifRefreshSubs.cbs.splice(i, 1)
      }
    }),
  }
})

const mockedFetchSessions = vi.mocked(fetchChatSessionListDeduped)
const mockedLoadNav = vi.mocked(loadNavHistory)
const mockedApiFetch = vi.mocked(apiFetch)

function tunnelListRow(peerHandle: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const gid = (typeof overrides.outboundGrantId === 'string' ? overrides.outboundGrantId : null) ?? 'grant-x'
  const outboundSessionId =
    overrides.outboundSessionId === undefined ? null : (overrides.outboundSessionId as string | null)
  const peerDisplayName =
    typeof overrides.peerDisplayName === 'string' ? overrides.peerDisplayName : 'Peer Display'
  const base = {
    peerUserId: 'usr_peer',
    outboundGrantId: gid,
    inboundGrantId: null,
    peerHandle,
    peerDisplayName,
    outboundSessionId,
    grantId: gid,
    ownerDisplayName: peerDisplayName,
    ownerHandle: peerHandle,
    ownerId: 'usr_peer',
    sessionId: outboundSessionId,
    lastActivityMs: 0,
    snippet: '',
    pendingReviewCount: 0,
    inboundPolicy: null,
  }
  return { ...base, ...overrides }
}

describe('ChatHistory.svelte', () => {
  beforeEach(() => {
    mockedLoadNav.mockResolvedValue([])
    mockedApiFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ tunnels: [] }), { status: 200 })),
    )
    hubTunnelSubs.cbs.length = 0
    hubNotifRefreshSubs.cbs.length = 0
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

  it('shows Tunnels section with pending badge and calls onOpenPendingTunnel', async () => {
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({ sessionId: 'own', sessionType: 'own', title: 'Local chat' }),
    ])
    mockedApiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (u.includes('/api/chat/b2b/tunnels')) {
        return new Response(
          JSON.stringify({
            tunnels: [tunnelListRow('ken-peer', { peerDisplayName: 'Ken Lay', pendingReviewCount: 1 })],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ tunnels: [] }), { status: 200 })
    })

    const onOpenPendingTunnel = vi.fn()
    render(ChatHistory, {
      props: { ...chatHistoryTestProps(), brainQueryEnabled: true, onOpenPendingTunnel },
    })

    const chats = await screen.findByRole('heading', { name: /^chats$/i })
    const tunnels = screen.getByRole('heading', { name: /^tunnels$/i })

    expect(within(chats.closest('.ch-group--chats') as HTMLElement).getByText('Local chat')).toBeInTheDocument()
    const tunnelsSection = tunnels.closest('.ch-group--tunnels') as HTMLElement
    expect(within(tunnelsSection).getByText('Ken Lay')).toBeInTheDocument()
    expect(document.querySelector('[data-tunnel-indicator="pending-review"]')).toBeTruthy()

    const pendingBtn = within(tunnelsSection).getByRole('button', {
      name: /open first pending collaborator — 1 pending/i,
    })
    expect(within(pendingBtn).getByText('1')).toBeInTheDocument()

    await fireEvent.click(pendingBtn)
    expect(onOpenPendingTunnel).toHaveBeenCalledTimes(1)
  })

  it('hides tunnels pending badge when merged API reports zero pending inbound work', async () => {
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({ sessionId: 'own', sessionType: 'own', title: 'Local chat' }),
    ])
    mockedApiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (u.includes('/api/chat/b2b/tunnels')) {
        return new Response(
          JSON.stringify({ tunnels: [tunnelListRow('p1', { pendingReviewCount: 0 })] }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ tunnels: [] }), { status: 200 })
    })

    render(ChatHistory, {
      props: { ...chatHistoryTestProps(), brainQueryEnabled: true, onOpenPendingTunnel: vi.fn() },
    })

    await screen.findByRole('heading', { name: /^chats$/i })
    const tunnelsSection = await waitFor(() =>
      screen.getByRole('heading', { name: /^tunnels$/i }).closest('.ch-group--tunnels'),
    )
    expect(tunnelsSection).toBeTruthy()
    await waitFor(() => {
      expect(
        within(tunnelsSection as HTMLElement).queryByRole('button', {
          name: /open first pending collaborator/i,
        }),
      ).not.toBeInTheDocument()
    })
  })

  it('calls onOpenColdTunnelEntry when Connect is pressed', async () => {
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({ sessionId: 'own', sessionType: 'own', title: 'Local chat' }),
    ])
    const onOpenColdTunnelEntry = vi.fn()
    mockedApiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (u.includes('/api/chat/b2b/tunnels')) {
        return new Response(JSON.stringify({ tunnels: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ tunnels: [] }), { status: 200 })
    })

    render(ChatHistory, {
      props: {
        ...chatHistoryTestProps(),
        brainQueryEnabled: true,
        onOpenColdTunnelEntry,
      },
    })

    await screen.findByRole('heading', { name: /^tunnels$/i })
    await fireEvent.click(screen.getByTestId('cold-query-open'))
    expect(onOpenColdTunnelEntry).toHaveBeenCalledTimes(1)
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

  it('Wiki section lists doc nav history only (not email)', async () => {
    mockedFetchSessions.mockResolvedValue([])
    mockedLoadNav.mockResolvedValue([
      {
        id: 'doc:test.md',
        type: 'doc',
        title: 'Ignored title',
        accessedAt: '2026-01-02T12:00:00.000Z',
        path: 'test.md',
      },
      {
        id: 'email:thr1',
        type: 'email',
        title: 'Some thread',
        accessedAt: '2026-01-03T12:00:00.000Z',
        path: 'thr1',
      },
    ])

    const props = chatHistoryTestProps()
    render(ChatHistory, {
      props: {
        ...props,
        onSelectDoc: vi.fn(),
        onWikiHome: vi.fn(),
      },
    })

    await screen.findByRole('heading', { name: /^wiki$/i })
    expect(screen.getByText('Test')).toBeInTheDocument()
    expect(screen.queryByText('Some thread')).not.toBeInTheDocument()
  })

  it('separates Chats from Wiki with a distinct section landmark', async () => {
    mockedFetchSessions.mockResolvedValue([])

    render(ChatHistory, {
      props: {
        ...chatHistoryTestProps(),
        onWikiHome: vi.fn(),
      },
    })

    await screen.findByRole('heading', { name: /^chats$/i })
    const wikiHeading = screen.getByRole('heading', { name: /^wiki$/i })
    const section = wikiHeading.closest('.ch-group--wiki')
    expect(section).toBeTruthy()
    expect(section?.className).toMatch(/ch-group--wiki/)
  })

  it('lists tunnels by most recent activity (lastActivityMs)', async () => {
    mockedFetchSessions.mockResolvedValue([])
    mockedApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          tunnels: [
            tunnelListRow('zebra-peer', {
              outboundGrantId: 'g-z',
              peerDisplayName: 'Zebra Peer',
              lastActivityMs: 2_000,
            }),
            tunnelListRow('alpha-peer', {
              outboundGrantId: 'g-a',
              peerDisplayName: 'Alpha Peer',
              lastActivityMs: 10_000,
            }),
          ],
        }),
        { status: 200 },
      ),
    )

    render(ChatHistory, {
      props: { ...chatHistoryTestProps(), onSelectTunnel: vi.fn(), brainQueryEnabled: true },
    })

    const tunnelsHeading = await screen.findByRole('heading', { name: /^tunnels$/i })
    const section = tunnelsHeading.closest('.ch-group--tunnels') as HTMLElement
    const tunnelButtons = within(section).getAllByRole('button').filter((btn) =>
      /Peer/i.test(btn.textContent ?? ''),
    )
    expect(tunnelButtons.map((btn) => (btn.textContent ?? '').trim())).toEqual([
      expect.stringMatching(/Alpha Peer/),
      expect.stringMatching(/Zebra Peer/),
    ])
  })

  it('selecting a tunnel row calls onSelectTunnel with collaborator handle', async () => {
    mockedFetchSessions.mockResolvedValue([])
    const onSelectTunnel = vi.fn()
    mockedApiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input instanceof Request ? input.url : input.pathname
      if (path.endsWith('/api/chat/b2b/tunnels')) {
        return new Response(
          JSON.stringify({
            tunnels: [tunnelListRow('open-target-h', { peerDisplayName: 'Open Target', outboundGrantId: 'grant-open' })],
          }),
          { status: 200 },
        )
      }
      return new Response('not mocked', { status: 501 })
    })

    render(ChatHistory, { props: { ...chatHistoryTestProps(), onSelectTunnel } })

    await screen.findByText('Open Target')
    await fireEvent.click(screen.getByText('Open Target').closest('[role="button"]')!)

    await waitFor(() => {
      expect(onSelectTunnel).toHaveBeenCalledWith('open-target-h')
      expect(mockedApiFetch.mock.calls.some((c) => String(c[0]).includes('/ensure-session'))).toBe(false)
    })
  })

  it('tunnel row shows awaiting indicator when outbound preview is waiting on collaborator', async () => {
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({
        sessionId: 'out-wait',
        sessionType: 'b2b_outbound',
        remoteGrantId: 'grant-wait',
        remoteHandle: '@peer',
        remoteDisplayName: 'Peer Wait',
        preview: `Lead text ${B2B_TUNNEL_AWAITING_PEER_PREVIEW_SNIPPET} tail`,
      }),
    ])
    mockedApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          tunnels: [
            tunnelListRow('@peer', {
              outboundGrantId: 'grant-wait',
              peerDisplayName: 'Peer Wait',
              outboundSessionId: 'out-wait',
            }),
          ],
        }),
        { status: 200 },
      ),
    )

    render(ChatHistory, { props: chatHistoryTestProps() })

    await screen.findByText('Peer Wait')
    const indicator = document.querySelector('[data-tunnel-indicator="awaiting"]')
    expect(indicator).toBeTruthy()
    expect(document.querySelector('[data-tunnel-indicator="new-reply"]')).not.toBeInTheDocument()
  })

  it('tunnel outbound SSE marker shows new reply dot after tunnel_activity', async () => {
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({
        sessionId: 'out-hit',
        sessionType: 'b2b_outbound',
        remoteGrantId: 'grant-hit',
        remoteHandle: '@hit',
        remoteDisplayName: 'Hit Peer',
        preview: 'Stale preview before push refresh',
      }),
    ])
    mockedApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          tunnels: [
            tunnelListRow('@hit', {
              outboundGrantId: 'grant-hit',
              peerDisplayName: 'Hit Peer',
              outboundSessionId: 'out-hit',
            }),
          ],
        }),
        { status: 200 },
      ),
    )

    render(ChatHistory, { props: chatHistoryTestProps() })

    await screen.findByText('Hit Peer')
    expect(document.querySelector('[data-tunnel-indicator="new-reply"]')).not.toBeInTheDocument()

    expect(hubTunnelSubs.cbs.length).toBeGreaterThanOrEqual(1)
    hubTunnelSubs.cbs[hubTunnelSubs.cbs.length - 1]!({
      scope: 'outbound',
      outboundSessionId: 'out-hit',
      grantId: 'grant-hit',
    })

    await waitFor(() => {
      expect(document.querySelector('[data-tunnel-indicator="new-reply"]')).toBeTruthy()
    })
  })

  it('tunnel_activity inbox triggers tunnels refetch so pending header badge appears from merged API counts', async () => {
    let tunnelRowsPayload: Record<string, unknown>[] = []
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({ sessionId: 'own', sessionType: 'own', title: 'Local chat' }),
    ])
    mockedApiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (u.includes('/api/chat/b2b/tunnels')) {
        return new Response(JSON.stringify({ tunnels: tunnelRowsPayload }), { status: 200 })
      }
      return new Response(JSON.stringify({ tunnels: [] }), { status: 200 })
    })

    render(ChatHistory, {
      props: { ...chatHistoryTestProps(), brainQueryEnabled: true, onOpenPendingTunnel: vi.fn() },
    })

    await screen.findByRole('heading', { name: /^tunnels$/i })
    const tunnelsSection = screen.getByRole('heading', { name: /^tunnels$/i }).closest(
      '.ch-group--tunnels',
    ) as HTMLElement
    expect(
      within(tunnelsSection).queryByRole('button', { name: /open first pending collaborator/i }),
    ).not.toBeInTheDocument()

    tunnelRowsPayload = [tunnelListRow('cold-peer', { pendingReviewCount: 1 })]
    const cb = hubTunnelSubs.cbs[hubTunnelSubs.cbs.length - 1]
    expect(cb).toBeDefined()
    cb!({ scope: 'inbox', inboundSessionId: 'cold-in', grantId: null })

    await waitFor(() => {
      expect(
        within(tunnelsSection).getByRole('button', {
          name: /open first pending collaborator — 1 pending/i,
        }),
      ).toBeInTheDocument()
    })
  })

  it('subscribeHubNotificationsRefresh callback triggers tunnels refetch so pending badge can appear', async () => {
    let tunnelRowsPayload: Record<string, unknown>[] = []
    mockedFetchSessions.mockResolvedValue([
      createChatSessionListItem({ sessionId: 'own', sessionType: 'own', title: 'Local chat' }),
    ])
    mockedApiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (u.includes('/api/chat/b2b/tunnels')) {
        return new Response(JSON.stringify({ tunnels: tunnelRowsPayload }), { status: 200 })
      }
      return new Response(JSON.stringify({ tunnels: [] }), { status: 200 })
    })

    render(ChatHistory, {
      props: { ...chatHistoryTestProps(), brainQueryEnabled: true, onOpenPendingTunnel: vi.fn() },
    })
    await screen.findByRole('heading', { name: /^tunnels$/i })
    const tunnelsSection = screen.getByRole('heading', { name: /^tunnels$/i }).closest(
      '.ch-group--tunnels',
    ) as HTMLElement
    expect(
      within(tunnelsSection).queryByRole('button', { name: /open first pending collaborator/i }),
    ).not.toBeInTheDocument()

    tunnelRowsPayload = [tunnelListRow('cold-peer', { pendingReviewCount: 1 })]
    const notifCb = hubNotifRefreshSubs.cbs[hubNotifRefreshSubs.cbs.length - 1]
    expect(notifCb).toBeDefined()
    notifCb!()

    await waitFor(() => {
      expect(
        within(tunnelsSection).getByRole('button', {
          name: /open first pending collaborator — 1 pending/i,
        }),
      ).toBeInTheDocument()
    })
  })
})
