import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@client/test/render.js'
import ReviewDetail from './ReviewDetail.svelte'
import * as apiFetchMod from '@client/lib/apiFetch.js'

const pendingRow = {
  sessionId: 's1',
  grantId: 'g1',
  isColdQuery: false,
  policy: 'review' as const,
  peerHandle: 'donna',
  peerDisplayName: null,
  askerSnippet: 'Hi',
  draftSnippet: 'Dr',
  state: 'pending',
  updatedAtMs: Date.now(),
}

function mockSession(draft = 'Original draft') {
  vi.spyOn(apiFetchMod, 'apiFetch').mockImplementation(async (input: RequestInfo | URL) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (u.includes('/api/chat/sessions/')) {
      return new Response(
        JSON.stringify({
          sessionId: 's1',
          messages: [
            { role: 'user', content: 'Hi there' },
            { role: 'assistant', content: draft },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (u.includes('/api/chat/b2b/dismiss') || u.includes('/api/chat/b2b/approve') || u.includes('/api/chat/b2b/decline')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (u.includes('/api/chat/b2b/grants/')) {
      return new Response(JSON.stringify({ ok: true, policy: 'review' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  })
}

describe('ReviewDetail.svelte', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows incoming question as subdued context and reply textarea for pending items', async () => {
    mockSession()

    render(ReviewDetail, {
      props: { row: pendingRow, onOpenInboundThread: vi.fn(), onMutate: vi.fn() },
    })

    await waitFor(() => {
      expect(screen.getByTestId('review-detail')).toBeInTheDocument()
    })
    // Single reply textarea (Issue 5)
    expect(await screen.findByTestId('review-reply-textarea')).toBeInTheDocument()
    // No separate "will-receive" preview box while pending
    expect(screen.queryByTestId('review-will-receive')).not.toBeInTheDocument()
  })

  it('loads session draft text into the reply textarea', async () => {
    mockSession('Pre-loaded draft')

    render(ReviewDetail, {
      props: { row: pendingRow, onOpenInboundThread: vi.fn(), onMutate: vi.fn() },
    })

    const textarea = (await screen.findByTestId('review-reply-textarea')) as HTMLTextAreaElement
    await waitFor(() => {
      expect(textarea.value).toBe('Pre-loaded draft')
    })
  })

  it('clicking Dismiss calls /dismiss endpoint and onMutate', async () => {
    mockSession()
    const onMutate = vi.fn()

    render(ReviewDetail, {
      props: { row: pendingRow, onOpenInboundThread: vi.fn(), onMutate },
    })

    await waitFor(() => expect(screen.getByTestId('review-detail')).toBeInTheDocument())
    const dismissBtn = await screen.findByRole('button', { name: /dismiss/i })
    await fireEvent.click(dismissBtn)

    await waitFor(() => expect(onMutate).toHaveBeenCalled())
  })

  it('shows read-only reply for non-pending items', async () => {
    vi.spyOn(apiFetchMod, 'apiFetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          sessionId: 's2',
          messages: [
            { role: 'user', content: 'Question' },
            { role: 'assistant', content: 'Sent answer' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    render(ReviewDetail, {
      props: {
        row: { ...pendingRow, sessionId: 's2', state: 'approved' },
        onOpenInboundThread: vi.fn(),
        onMutate: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('review-will-receive')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('review-reply-textarea')).not.toBeInTheDocument()
  })
})
