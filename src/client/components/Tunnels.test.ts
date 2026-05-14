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
    legacyInboundSessionId: null,
    brainQueryEnabled: true,
    onPickTunnelHandle: vi.fn(),
    onReplaceLegacyReviewRoute: undefined,
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

  it('without route shows empty prompt and connect', async () => {
    render(Tunnels, {
      props: {
        ...baseProps,
        routeTunnelHandle: null,
      },
    })

    expect(await screen.findByTestId('tunnels-empty')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument()
  })

  it('resolves legacy review session id and calls onReplaceLegacyReviewRoute', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ tunnelHandle: 'resolved-peer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const onReplaceLegacyReviewRoute = vi.fn()
    render(Tunnels, {
      props: {
        ...baseProps,
        legacyInboundSessionId: 'legacy-sid',
        onReplaceLegacyReviewRoute,
      },
    })

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/api/chat/b2b/peer-handle-for-review/legacy-sid')
      expect(onReplaceLegacyReviewRoute).toHaveBeenCalledWith('resolved-peer')
    })
  })
})
