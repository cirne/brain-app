import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@client/test/render.js'
import Tunnels from './Tunnels.svelte'
import { apiFetch } from '@client/lib/apiFetch.js'

vi.mock('@client/lib/apiFetch.js', () => ({
  apiFetch: vi.fn(),
}))

describe('Tunnels.svelte', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
  })

  const baseProps = {
    brainQueryEnabled: true,
    onPickTunnelHandle: vi.fn(),
    onOpenColdTunnelEntry: vi.fn(),
  }

  it('with route handle shows tunnel detail (rail holds the list)', async () => {
    const timelineJson = JSON.stringify({
      peerDisplayName: 'Alpha Peer',
      inboundGrantId: null,
      outboundGrantId: 'g-peer',
      inboundPolicy: null,
      timeline: [],
    })
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(timelineJson, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    render(Tunnels, {
      props: {
        ...baseProps,
        routeTunnelHandle: 'alpha-peer',
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('tunnel-detail-header')).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Alpha Peer')
    })
    expect(baseProps.onPickTunnelHandle).not.toHaveBeenCalled()
  })

  it('without route loads tunnels index list and connect', async () => {
    vi.mocked(apiFetch).mockImplementation((input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : String(input)
      if (u.includes('/api/chat/b2b/tunnels')) {
        return Promise.resolve(
          new Response(JSON.stringify({ tunnels: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (u.includes('/api/chat/b2b/review')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    render(Tunnels, {
      props: {
        ...baseProps,
        routeTunnelHandle: null,
      },
    })

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/api/chat/b2b/tunnels')
    })
    expect(await screen.findByTestId('tunnels-list')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /connect/i })).toBeInTheDocument()
  })

  it('tunnel row navigates to handle', async () => {
    vi.mocked(apiFetch).mockImplementation((input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : String(input)
      if (u.includes('/api/chat/b2b/tunnels')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tunnels: [
                {
                  peerUserId: 'u1',
                  outboundGrantId: 'og',
                  inboundGrantId: 'ig',
                  peerHandle: 'alpha-peer',
                  peerDisplayName: 'Alpha',
                  outboundSessionId: null,
                  grantId: 'og',
                  ownerDisplayName: 'Alpha',
                  ownerHandle: 'alpha-peer',
                  ownerId: 'u1',
                  sessionId: null,
                  lastActivityMs: 1_700_000_000_000,
                  snippet: 'Last msg',
                  pendingReviewCount: 1,
                  inboundPolicy: 'review',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (u.includes('/api/chat/b2b/review')) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    const onPickTunnelHandle = vi.fn()
    render(Tunnels, {
      props: {
        ...baseProps,
        routeTunnelHandle: null,
        onPickTunnelHandle,
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('tunnels-list-row-alpha-peer')).toBeInTheDocument()
    })
    await screen.getByTestId('tunnels-list-row-alpha-peer').click()
    expect(onPickTunnelHandle).toHaveBeenCalledWith('alpha-peer')
  })
})
