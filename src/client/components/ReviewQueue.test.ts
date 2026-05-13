import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@client/test/render.js'
import ReviewQueue from './ReviewQueue.svelte'

class MockResizeObserver {
  private callback: ResizeObserverCallback
  private elements = new Set<Element>()
  static instances: MockResizeObserver[] = []

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    MockResizeObserver.instances.push(this)
  }

  observe(el: Element) {
    this.elements.add(el)
  }

  unobserve(el: Element) {
    this.elements.delete(el)
  }

  disconnect() {
    this.elements.clear()
  }

  trigger(width: number) {
    const entries = Array.from(this.elements).map((target) => ({
      target,
      contentRect: { width, height: 600 } as DOMRectReadOnly,
      borderBoxSize: [] as ResizeObserverSize[],
      contentBoxSize: [] as ResizeObserverSize[],
      devicePixelContentBoxSize: [] as ResizeObserverSize[],
    }))
    this.callback(entries, this)
  }

  static reset() {
    MockResizeObserver.instances = []
  }
}

describe('ReviewQueue.svelte', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    MockResizeObserver.reset()
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
  })

  it('wide inset: loads rows and shows split empty copy when API returns no items', async () => {
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
    MockResizeObserver.instances[0]?.trigger(900)

    await waitFor(() => {
      expect(screen.getByTestId('review-queue-split')).toBeInTheDocument()
    })
    expect(await screen.findByTestId('review-queue-empty-list')).toBeInTheDocument()
    expect(await screen.findByText(/All caught up/i)).toBeInTheDocument()
    expect(screen.getByTestId('review-queue-empty-detail')).toBeInTheDocument()
    expect(screen.queryByTestId('review-queue-empty-compact')).not.toBeInTheDocument()
  })

  it('compact inset: merged empty state only', async () => {
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
    MockResizeObserver.instances[0]?.trigger(400)

    await waitFor(() => {
      expect(screen.getByTestId('review-queue-empty-compact')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('review-queue-empty-list')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-queue-empty-detail')).not.toBeInTheDocument()
    expect(screen.getByText(/nothing is waiting for your approval/i)).toBeInTheDocument()
  })

  it('wide inset: auto-selects first pending row so detail is shown without a click', async () => {
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

    MockResizeObserver.instances[0]?.trigger(900)

    await waitFor(() => {
      expect(screen.getByTestId('review-detail')).toBeInTheDocument()
    })
  })

  it('compact inset: shows queue nav and jump select when multiple rows', async () => {
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
              peerHandle: 'bob',
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

    MockResizeObserver.instances[0]?.trigger(480)

    await waitFor(() => {
      expect(screen.getByTestId('review-detail')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('review-queue-split')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Previous conversation/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Next conversation/i)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Jump to/i })).toBeInTheDocument()
  })
})
