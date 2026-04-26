import { describe, it, expect, vi } from 'vitest'
import EmailPreviewCard from './EmailPreviewCard.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('EmailPreviewCard.svelte', () => {
  it('renders subject, from, snippet and calls onOpen', async () => {
    const onOpen = vi.fn()
    render(EmailPreviewCard, {
      props: {
        subject: 'Re: Plan',
        from: 'you@example.com',
        snippet: 'Sounds good.',
        onOpen,
      },
    })

    expect(screen.getByText('Re: Plan')).toBeInTheDocument()
    expect(screen.getByText('you@example.com')).toBeInTheDocument()
    expect(screen.getByText('Sounds good.')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /open email thread: re: plan/i }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
