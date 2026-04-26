import { describe, it, expect, vi, beforeEach } from 'vitest'
import InboxListPreviewCard from './InboxListPreviewCard.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('InboxListPreviewCard.svelte', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/inbox/') && url.endsWith('/archive')) {
        return { ok: true, json: async () => ({}) } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    }) as typeof fetch
  })

  it('renders head meta and opens a row', async () => {
    const onOpenEmail = vi.fn()
    render(InboxListPreviewCard, {
      props: {
        items: [
          {
            id: 'mid1',
            subject: 'Hi',
            from: 'a@b.co',
            snippet: 'Yo',
            date: '2026-04-01',
          },
        ],
        totalCount: 1,
        onOpenEmail,
      },
    })

    expect(screen.getByText(/1 message/)).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: /open: hi/i }))
    expect(onOpenEmail).toHaveBeenCalledWith('mid1', 'Hi', 'a@b.co')
  })

  it('posts archive when archive is clicked', async () => {
    render(InboxListPreviewCard, {
      props: {
        items: [
          {
            id: 'to-archive',
            subject: 'Old',
            from: 'x@y.z',
            snippet: '',
            date: '2026-04-01',
          },
        ],
        totalCount: 1,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /archive message/i }))
    expect(globalThis.fetch).toHaveBeenCalled()
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) =>
      String(u).includes('to-archive'),
    )
    expect(call).toBeTruthy()
  })
})
