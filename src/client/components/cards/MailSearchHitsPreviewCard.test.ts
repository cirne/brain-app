import { describe, it, expect, vi } from 'vitest'
import MailSearchHitsPreviewCard from './MailSearchHitsPreviewCard.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('MailSearchHitsPreviewCard.svelte', () => {
  it('shows empty state when there are no hits', () => {
    render(MailSearchHitsPreviewCard, {
      props: { queryLine: 'from:alice', items: [] },
    })
    expect(screen.getByText('from:alice')).toBeInTheDocument()
    expect(
      screen.getByText(/no matching emails or indexed files/i),
    ).toBeInTheDocument()
  })

  it('lists rows and calls onOpenEmail', async () => {
    const onOpenEmail = vi.fn()
    render(MailSearchHitsPreviewCard, {
      props: {
        queryLine: 'subject:foo',
        items: [
          { id: 'm1', subject: 'Hello', from: 'bob@x.test', snippet: 'Hi there' },
        ],
        onOpenEmail,
      },
    })

    await fireEvent.click(screen.getByRole('button'))
    expect(onOpenEmail).toHaveBeenCalledWith('m1', 'Hello', 'bob@x.test')
  })

  it('shows Google Drive metadata for Drive hits, not Indexed file', () => {
    render(MailSearchHitsPreviewCard, {
      props: {
        queryLine: 'drive',
        items: [
          {
            id: 'f1',
            subject: 'Summary.pdf',
            from: '',
            snippet: 'hit',
            sourceKind: 'googleDrive',
            date: '2026-06-01T12:00:00.000Z',
          },
        ],
      },
    })
    expect(screen.getByText(/Google Drive/i)).toBeInTheDocument()
    expect(screen.queryByText(/^Indexed file$/)).not.toBeInTheDocument()
  })
})
