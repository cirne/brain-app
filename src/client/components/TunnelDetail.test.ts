import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@client/test/render.js'
import TunnelDetail from './TunnelDetail.svelte'
import { apiFetch } from '@client/lib/apiFetch.js'
import { getBuiltinPolicyBodiesFromDisk } from '@server/lib/brainQuery/builtinPolicyBodiesFromDisk.js'
import { resetBrainQueryBuiltinPolicyBodiesCacheForTests } from '@client/lib/brainQueryBuiltinPolicyBodiesApi.js'
import { consumeTunnelOutboundSendStream } from '@client/lib/consumeTunnelOutboundSendStream.js'

vi.mock('@client/lib/apiFetch.js', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('@client/lib/consumeTunnelOutboundSendStream.js', () => ({
  consumeTunnelOutboundSendStream: vi.fn(),
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

const diskBodies = getBuiltinPolicyBodiesFromDisk()
const trustedText = diskBodies.trusted
const generalText = diskBodies.general

function timelineJson(over: Record<string, unknown> = {}) {
  return {
    peerDisplayName: 'Taylor',
    inboundGrantId: 'grant-in',
    outboundGrantId: 'og',
    inboundPolicy: 'review',
    inboundPrivacyPolicy: trustedText,
    inboundPresetPolicyKey: 'trusted',
    inboundCustomPolicyId: null,
    timeline: [],
    ...over,
  }
}

describe('TunnelDetail.svelte', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
    vi.mocked(consumeTunnelOutboundSendStream).mockReset()
    tunnelActivityHandler = null
    resetBrainQueryBuiltinPolicyBodiesCacheForTests()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (u.includes('/api/brain-query/builtin-policy-bodies')) {
          return Promise.resolve(new Response(JSON.stringify({ bodies: diskBodies }), { status: 200 }))
        }
        if (u.includes('/api/brain-query/policies')) {
          return Promise.resolve(new Response(JSON.stringify({ policies: [] }), { status: 200 }))
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as typeof fetch,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetBrainQueryBuiltinPolicyBodiesCacheForTests()
  })

  it('renders auto-sent hint when timeline message carries auto_sent hint', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          peerDisplayName: 'Taylor',
          inboundGrantId: null,
          outboundGrantId: 'og',
          inboundPolicy: null,
          inboundPrivacyPolicy: null,
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
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('tunnel-message-hint')).toHaveTextContent('Auto-sent')
    })
  })

  it('changing reply to Autosend opens confirm then PATCHes b2b grants to auto', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(timelineJson()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(timelineJson({ inboundPolicy: 'auto' })),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )

    render(TunnelDetail, {
      props: {
        tunnelHandle: 'peer-h',
      },
    })

    await screen.findByTestId('tunnel-detail-reply-auto')
    await fireEvent.click(screen.getByTestId('tunnel-detail-reply-auto'))

    const dialog = await screen.findByRole('dialog')
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Autosend' }))

    await waitFor(() => {
      expect(
        vi.mocked(apiFetch).mock.calls.some(
          ([url, init]) =>
            String(url).includes('/api/chat/b2b/grants/grant-in') &&
            init &&
            'method' in init &&
            init.method === 'PATCH' &&
            typeof init.body === 'string' &&
            init.body.includes('"policy":"auto"'),
        ),
      ).toBe(true)
    })
  })

  it('changing access preset PATCHes brain-query grant preset key', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(timelineJson()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'grant-in' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(timelineJson({ inboundPrivacyPolicy: generalText, inboundPresetPolicyKey: 'general' })),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )

    render(TunnelDetail, {
      props: {
        tunnelHandle: 'peer-h',
      },
    })

    const sel = await screen.findByTestId('tunnel-detail-policy-select')
    await fireEvent.change(sel, { target: { value: 'general' } })

    await waitFor(() => {
      expect(
        vi.mocked(apiFetch).mock.calls.some(
          ([url, init]) =>
            String(url).includes('/api/brain-query/grants/grant-in') &&
            init &&
            'method' in init &&
            init.method === 'PATCH' &&
            typeof init.body === 'string' &&
            init.body.includes('"presetPolicyKey"') &&
            init.body.includes('general'),
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
      inboundPrivacyPolicy: null,
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

  it('sends cold-query when there is no outbound grant but peerUserId is present', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            peerDisplayName: 'ColdPeer',
            peerUserId: 'usr-peer-cold',
            inboundGrantId: null,
            outboundGrantId: null,
            inboundPolicy: null,
            inboundPrivacyPolicy: null,
            timeline: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sessionId: 'out-cold-sid' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            peerDisplayName: 'ColdPeer',
            peerUserId: 'usr-peer-cold',
            inboundGrantId: null,
            outboundGrantId: null,
            inboundPolicy: null,
            inboundPrivacyPolicy: null,
            timeline: [
              {
                kind: 'message' as const,
                id: 'cold-u',
                atMs: 1,
                side: 'yours' as const,
                actor: 'you' as const,
                body: 'Reach out text',
                hint: 'to_their_brain' as const,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )

    render(TunnelDetail, {
      props: {
        tunnelHandle: 'cold-peer',
      },
    })

    await waitFor(() => {
      expect(screen.getByText(/send a request to connect/i)).toBeInTheDocument()
    })

    const input = await screen.findByPlaceholderText(/message their assistant/i)
    await fireEvent.input(input, { target: { value: 'Reach out text' } })
    await fireEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/api/chat/b2b/cold-query',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"targetUserId":"usr-peer-cold"'),
        }),
      )
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/api/chat/b2b/cold-query',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"message":"Reach out text"'),
        }),
      )
      expect(screen.getByText('Reach out text')).toBeInTheDocument()
    })
    expect(vi.mocked(consumeTunnelOutboundSendStream)).not.toHaveBeenCalled()
  })

  it('sending a message updates pendingOutbound and calls stream consumer', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(timelineJson()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(timelineJson()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )

    vi.mocked(consumeTunnelOutboundSendStream).mockResolvedValueOnce({
      sessionId: 'out-123',
      assistantText: 'Hello from brain',
      b2bAwaitingPeerReview: false,
      b2bNoReplyExpected: false,
      sawDone: true,
    })

    render(TunnelDetail, {
      props: {
        tunnelHandle: 'peer-h',
      },
    })

    await screen.findByPlaceholderText(/message their assistant/i)
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/message their assistant/i)).not.toBeDisabled()
    })
    const input = screen.getByPlaceholderText(/message their assistant/i)
    await fireEvent.input(input, { target: { value: 'Hello peer' } })
    await fireEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/api/chat/b2b/send',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"message":"Hello peer"'),
        }),
      )
      expect(vi.mocked(consumeTunnelOutboundSendStream)).toHaveBeenCalled()
    })
  })

  it('shows awaiting receipt label when b2bAwaitingPeerReview is true', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...timelineJson(),
          timeline: [
            {
              kind: 'message',
              id: 'm-wait',
              atMs: Date.now(),
              side: 'theirs',
              actor: 'their_brain',
              body: 'Should be hidden',
              b2bAwaitingPeerReview: true,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    render(TunnelDetail, {
      props: {
        tunnelHandle: 'peer-h',
      },
    })

    await waitFor(() => {
      expect(screen.getByText(/they'll approve the reply/i)).toBeInTheDocument()
      expect(screen.queryByText('Should be hidden')).not.toBeInTheDocument()
    })
  })

  it('shows error message when timeline load fails', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(null, { status: 500 }))

    render(TunnelDetail, {
      props: {
        tunnelHandle: 'peer-h',
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/could not load tunnel activity/i)
    })
  })

  it('mobile trigger opens bottom sheet', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      new Response(JSON.stringify(timelineJson()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    // Mock window.innerWidth to be small
    const originalWidth = window.innerWidth
    window.innerWidth = 375
    fireEvent(window, new Event('resize'))

    render(TunnelDetail, {
      props: {
        tunnelHandle: 'peer-h',
      },
    })

    const trigger = await screen.findByTestId('tunnel-detail-connection-mobile-trigger')
    await fireEvent.click(trigger)

    await waitFor(() => {
      expect(screen.getByTestId('tunnel-detail-connection-controls')).toBeInTheDocument()
    })

    window.innerWidth = originalWidth
  })
})
