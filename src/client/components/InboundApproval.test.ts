import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@client/test/render.js'
import { createMockFetch, jsonResponse } from '@client/test/mocks/fetch.js'
import InboundApproval from './InboundApproval.svelte'

describe('InboundApproval.svelte', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('approves with the edited answer', async () => {
    const approve = vi.fn((_url: string, _init?: RequestInit) => jsonResponse({ ok: true }))
    vi.stubGlobal(
      'fetch',
      createMockFetch([
        {
          match: (u: string, init?: RequestInit) =>
            u === '/api/chat/b2b/approve' && init?.method === 'POST',
          response: approve,
        },
      ]),
    )
    const onDone = vi.fn()

    render(InboundApproval, {
      props: {
        sessionId: 'sess-inbound',
        initialAnswer: 'Original answer',
        onDone,
      },
    })

    const textarea = screen.getByRole('textbox', { name: /answer to send/i })
    await fireEvent.input(textarea, { target: { value: 'Edited answer' } })
    await fireEvent.click(screen.getByRole('button', { name: /approve and send/i }))

    await waitFor(() => expect(approve).toHaveBeenCalled())
    const init = approve.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      sessionId: 'sess-inbound',
      editedAnswer: 'Edited answer',
    })
    expect(onDone).toHaveBeenCalled()
  })

  it('declines the inbound request', async () => {
    const decline = vi.fn((_url: string, _init?: RequestInit) => jsonResponse({ ok: true }))
    vi.stubGlobal(
      'fetch',
      createMockFetch([
        {
          match: (u: string, init?: RequestInit) =>
            u === '/api/chat/b2b/decline' && init?.method === 'POST',
          response: decline,
        },
      ]),
    )

    render(InboundApproval, {
      props: {
        sessionId: 'sess-inbound',
        initialAnswer: 'Original answer',
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /decline/i }))

    await waitFor(() => expect(decline).toHaveBeenCalled())
    const init = decline.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: 'sess-inbound' })
  })
})
