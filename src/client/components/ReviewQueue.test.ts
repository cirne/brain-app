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
})
