import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@client/test/render.js'
import TunnelPendingMessage from './TunnelPendingMessage.svelte'

vi.mock('./TipTapMarkdownEditor.svelte', () => import('./test-stubs/TipTapMarkdownEditorStub.svelte'))

import { apiFetch } from '@client/lib/apiFetch.js'
import { emit } from '@client/lib/app/appEvents.js'
import type { TunnelTimelinePendingReviewApi } from '@shared/tunnelTimeline.js'
import { B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT } from '@shared/b2bTunnelDelivery.js'

vi.mock('@client/lib/apiFetch.js', () => ({
  apiFetch: vi.fn(),
}))
vi.mock('@client/lib/app/appEvents.js', () => ({
  emit: vi.fn(),
}))

describe('TunnelPendingMessage.svelte', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset()
    vi.mocked(emit).mockReset()
  })

  const baseRow = (): TunnelTimelinePendingReviewApi => ({
    kind: 'pending_review',
    id: 'pend:sess-x',
    atMs: 1,
    sessionId: 'sess-x',
    grantId: 'grant-g',
    isColdQuery: false,
    policy: 'review',
    peerHandle: 'alice',
    peerDisplayName: 'Alice',
    askerSnippet: 'Inbound question?',
    draftSnippet: 'Suggested reply.',
    state: 'pending',
    updatedAtMs: 1,
    expectsResponse: true,
  })

  it('approve posts /approve and emits b2b:review-changed', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const onMutate = vi.fn().mockResolvedValue(undefined)
    render(TunnelPendingMessage, { props: { row: baseRow(), onMutate } })

    const send = screen.getByRole('button', { name: /^send$/i })
    await waitFor(() => expect(send).not.toBeDisabled())
    await fireEvent.click(send)

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/api/chat/b2b/approve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ sessionId: 'sess-x', editedAnswer: 'Suggested reply.' }),
        }),
      )
      expect(emit).toHaveBeenCalledWith({ type: 'b2b:review-changed' })
      expect(onMutate).toHaveBeenCalled()
    })
  })

  it('dismiss posts /dismiss and emits b2b:review-changed', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const onMutate = vi.fn().mockResolvedValue(undefined)
    render(TunnelPendingMessage, { props: { row: baseRow(), onMutate } })

    await fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }))

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
        '/api/chat/b2b/dismiss',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ sessionId: 'sess-x' }),
        }),
      )
      expect(emit).toHaveBeenCalledWith({ type: 'b2b:review-changed' })
    })
  })

  it('hides Dismiss while draft is the cold-query drafting placeholder', () => {
    const row: TunnelTimelinePendingReviewApi = {
      ...baseRow(),
      isColdQuery: true,
      draftSnippet: B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT,
    }
    render(TunnelPendingMessage, { props: { row, onMutate: vi.fn() } })

    expect(screen.queryByRole('button', { name: /^dismiss$/i })).toBeNull()
    expect(screen.getByTestId('tunnel-pending-drafting')).toBeTruthy()
  })
})
