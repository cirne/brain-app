import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@client/test/render.js'
import ReviewQueue from './ReviewQueue.svelte'

describe('ReviewQueue.svelte', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads rows and shows empty copy when API returns no items', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch

    render(ReviewQueue, {
      props: {
        initialSessionId: null,
        onNavigateSession: vi.fn(),
        onOpenInboundThread: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('review-queue')).toBeInTheDocument()
    })
    expect(await screen.findByTestId('review-queue-empty-list')).toBeInTheDocument()
    expect(await screen.findByText(/All caught up/i)).toBeInTheDocument()
    expect(screen.getByTestId('review-queue-empty-detail')).toBeInTheDocument()
  })

  it('auto-selects first pending row so detail is shown without a click', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              sessionId: 's-first',
              grantId: 'g1',
              isColdQuery: false,
              policy: 'review',
              peerHandle: 'alice',
              peerDisplayName: null,
              askerSnippet: 'Q1',
              draftSnippet: 'D1',
              state: 'pending',
              updatedAtMs: 1000,
            },
            {
              sessionId: 's-second',
              grantId: 'g1',
              isColdQuery: false,
              policy: 'review',
              peerHandle: 'alice',
              peerDisplayName: null,
              askerSnippet: 'Q2',
              draftSnippet: 'D2',
              state: 'pending',
              updatedAtMs: 2000,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch

    render(ReviewQueue, {
      props: {
        initialSessionId: null,
        onNavigateSession: vi.fn(),
        onOpenInboundThread: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('review-detail')).toBeInTheDocument()
    })
  })
})
