import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@client/test/render.js'
import TunnelDetail from './TunnelDetail.svelte'
import { apiFetch } from '@client/lib/apiFetch.js'

vi.mock('@client/lib/apiFetch.js', () => ({
  apiFetch: vi.fn(),
}))

let tunnelActivityHandler: ((_p: unknown) => void) | null = null
vi.mock('@client/lib/hubEvents/hubEventsClient.js', () => ({
  subscribeTunnelActivity: vi.fn((cb: (_p: unknown) => void) => {
    tunnelActivityHandler = cb
    return () => {
      tunnelActivityHandler = null
    }
  }),
}))

describe('TunnelDetail.svelte', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
    tunnelActivityHandler = null
  })

  it('renders auto-sent hint when timeline message carries auto_sent hint', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          peerDisplayName: 'Taylor',
          inboundGrantId: null,
          outboundGrantId: 'og',
          inboundPolicy: null,
          timeline: [
            {
              kind: 'message',
              id: 'm-auto',
              atMs: Date.now(),
              side: 'yours',
              actor: 'your_brain',
              body: 'Sent automatically',
              hint: 'auto_sent',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    render(TunnelDetail, {
      props: {
        tunnelHandle: 'peer-h',
        onOpenOutboundChat: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('tunnel-message-hint')).toHaveTextContent('Auto-sent')
    })
  })

  it('changing policy PATCHes grants endpoint', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            peerDisplayName: 'Taylor',
            inboundGrantId: 'grant-in',
            outboundGrantId: 'og',
            inboundPolicy: 'review',
            timeline: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            peerDisplayName: 'Taylor',
            inboundGrantId: 'grant-in',
            outboundGrantId: 'og',
            inboundPolicy: 'ignore',
            timeline: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )

    render(TunnelDetail, {
      props: {
        tunnelHandle: 'peer-h',
        onOpenOutboundChat: vi.fn(),
      },
    })

    const sel = await screen.findByTestId('tunnel-detail-policy-select')
    await fireEvent.change(sel, { target: { value: 'ignore' } })

    await waitFor(() => {
      expect(vi.mocked(apiFetch).mock.calls.some(([url, init]) => String(url).includes('/api/chat/b2b/grants/grant-in'))).toBe(
        true,
      )
      expect(
        vi.mocked(apiFetch).mock.calls.some(
          ([url, init]) =>
            String(url).includes('/api/chat/b2b/grants/grant-in') &&
            init &&
            'method' in init &&
            init.method === 'PATCH' &&
            typeof init.body === 'string' &&
            init.body.includes('"policy":"ignore"'),
        ),
      ).toBe(true)
    })
  })

  it('refetches timeline when tunnel_activity outbound fires', async () => {
    const timelineBody = {
      peerDisplayName: 'Peer',
      inboundGrantId: null,
      outboundGrantId: 'og',
      inboundPolicy: null,
      timeline: [
        {
          kind: 'message' as const,
          id: 'm1',
          atMs: 1,
          side: 'theirs' as const,
          actor: 'their_brain' as const,
          body: 'Updated',
        },
      ],
    }
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(JSON.stringify(timelineBody), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    render(TunnelDetail, {
      props: {
        tunnelHandle: 'peer-h',
        onOpenOutboundChat: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(screen.getByText('Updated')).toBeInTheDocument()
    })
    const callsAfterFirst = vi.mocked(apiFetch).mock.calls.length

    vi.mocked(apiFetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...timelineBody,
          timeline: [
            {
              kind: 'message' as const,
              id: 'm2',
              atMs: 2,
              side: 'theirs' as const,
              actor: 'their_brain' as const,
              body: 'After push',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    expect(tunnelActivityHandler).toBeTypeOf('function')
    tunnelActivityHandler!({ scope: 'outbound', outboundSessionId: 'sid-x' })

    await waitFor(() => {
      expect(screen.getByText('After push')).toBeInTheDocument()
    })
    expect(vi.mocked(apiFetch).mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })
})
