import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@client/test/render.js'
import ReviewDetail from './ReviewDetail.svelte'
import * as apiFetchMod from '@client/lib/apiFetch.js'

describe('ReviewDetail.svelte', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads session and shows will-receive preview from draft edits', async () => {
    vi.spyOn(apiFetchMod, 'apiFetch').mockImplementation(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (u.includes('/api/chat/sessions/')) {
        return new Response(
          JSON.stringify({
            sessionId: 's1',
            messages: [
              { role: 'user', content: 'Hi there' },
              { role: 'assistant', content: 'Original draft' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 404 })
    })

    const onMutate = vi.fn()
    render(ReviewDetail, {
      props: {
        row: {
          sessionId: 's1',
          grantId: 'g1',
          peerHandle: 'donna',
          peerDisplayName: null,
          askerSnippet: 'Hi',
          draftSnippet: 'Dr',
          state: 'pending',
          updatedAtMs: Date.now(),
        },
        onOpenInboundThread: vi.fn(),
        onMutate,
      },
    })

    await waitFor(() => {
      expect(screen.getByTestId('review-detail')).toBeInTheDocument()
    })
    const draft = await screen.findByRole('textbox', { name: /your assistant drafted/i })
    await fireEvent.input(draft, { target: { value: 'Edited reply' } })
    expect(screen.getByTestId('review-will-receive')).toHaveTextContent('Edited reply')
  })
})
