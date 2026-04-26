import { describe, it, expect, vi } from 'vitest'
import MessageThreadPreviewCard from './MessageThreadPreviewCard.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('MessageThreadPreviewCard.svelte', () => {
  it('renders chat label, snippet, meta, and calls onOpen', async () => {
    const onOpen = vi.fn()
    render(MessageThreadPreviewCard, {
      props: {
        displayChat: 'Alice',
        snippet: 'Last message preview',
        previewMessages: [
          { sent_at_unix: 1_700_000_000, is_from_me: false, text: 'Hey' },
        ],
        total: 40,
        returnedCount: 3,
        person: ['Alice Smith'],
        onOpen,
      },
    })

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Last message preview')).toBeInTheDocument()
    expect(screen.getByText(/3 shown · 40 in window/)).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /open message thread: alice/i }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
