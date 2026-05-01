import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@client/test/render.js'
import MailSearchResultsPanel from './MailSearchResultsPanel.svelte'

describe('MailSearchResultsPanel.svelte', () => {
  it('renders all search hits and opens the selected email', async () => {
    const onOpenEmail = vi.fn()
    render(MailSearchResultsPanel, {
      props: {
        queryLine: 'Search mail: invoice',
        totalMatched: 3,
        items: [
          { id: 'msg-1', subject: 'First invoice', from: 'a@example.com', snippet: 'First body' },
          { id: 'msg-2', subject: 'Second invoice', from: 'b@example.com', snippet: 'Second body' },
          { id: 'msg-3', subject: 'Third invoice', from: 'c@example.com', snippet: 'Third body' },
        ],
        onOpenEmail,
      },
    })

    expect(screen.getByText('Search mail: invoice')).toBeInTheDocument()
    expect(screen.getByText('3 results')).toBeInTheDocument()
    expect(screen.getByText('First invoice')).toBeInTheDocument()
    expect(screen.getByText('Second invoice')).toBeInTheDocument()
    expect(screen.getByText('Third invoice')).toBeInTheDocument()
    expect(screen.queryByText(/\+.*more/)).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /open email second invoice/i }))

    expect(onOpenEmail).toHaveBeenCalledWith('msg-2', 'Second invoice', 'b@example.com')
  })

  it('opens indexed file hits via onOpenIndexedFile', async () => {
    const onOpenEmail = vi.fn()
    const onOpenIndexedFile = vi.fn()
    render(MailSearchResultsPanel, {
      props: {
        queryLine: 'Drive search',
        totalMatched: 1,
        searchSource: 'acct-drive',
        items: [
          {
            id: 'f1',
            subject: 'Notes.pdf',
            from: '',
            snippet: '',
            sourceKind: 'googleDrive',
          },
        ],
        onOpenEmail,
        onOpenIndexedFile,
      },
    })

    await fireEvent.click(
      screen.getByRole('button', { name: /open indexed file notes\.pdf.*google drive/i }),
    )
    expect(onOpenIndexedFile).toHaveBeenCalledWith('f1', 'acct-drive')
    expect(onOpenEmail).not.toHaveBeenCalled()
  })

  it('shows date for slim indexed row without sourceKind', () => {
    render(MailSearchResultsPanel, {
      props: {
        queryLine: 'q',
        totalMatched: 50,
        items: [
          {
            id: 'x1',
            subject: 'doc.pdf',
            from: '',
            snippet: '',
            date: '2026-03-15T00:00:00.000Z',
          },
        ],
      },
    })
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('renders empty state for no hits', () => {
    render(MailSearchResultsPanel, {
      props: {
        queryLine: 'Search mail: no hits',
        items: [],
      },
    })

    expect(screen.getByText('Search mail: no hits')).toBeInTheDocument()
    expect(screen.getByText(/No matching emails or indexed files/i)).toBeInTheDocument()
  })

  it('renders unavailable state when tool-derived results are not in memory', () => {
    render(MailSearchResultsPanel, {
      props: {
        queryLine: 'Search mail: invoice',
        items: null,
      },
    })

    expect(screen.getByText('Search mail: invoice')).toBeInTheDocument()
    expect(screen.getByText(/Search results are no longer available/i)).toBeInTheDocument()
  })
})
