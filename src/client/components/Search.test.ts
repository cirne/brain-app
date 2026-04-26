import { describe, it, expect, vi } from 'vitest'
import Search from './Search.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'
import { createMockFetch, jsonResponse } from '@client/test/mocks/fetch.js'
import { createWikiSearchResult } from '@client/test/fixtures/search.js'
import { useSearchDebounceTimers } from '@client/test/helpers/index.js'

describe('Search.svelte', () => {
  useSearchDebounceTimers()

  it('shows hint when query empty and fetches after debounce when typing', async () => {
    const onOpenWiki = vi.fn()
    const onOpenEmail = vi.fn()
    const onClose = vi.fn()

    const mockFetch = createMockFetch([
      {
        match: (u) => u.startsWith('/api/search?'),
        response: () =>
          jsonResponse({
            results: [createWikiSearchResult({ path: 'a.md', excerpt: 'ex' })],
          }),
      },
    ])
    vi.stubGlobal('fetch', mockFetch)

    render(Search, {
      props: { onOpenWiki, onOpenEmail, onClose },
    })

    expect(screen.getByText(/Search your docs and emails/i)).toBeInTheDocument()

    const input = screen.getByPlaceholderText(/Search your docs and emails/i)
    await fireEvent.input(input, { target: { value: 'hello' } })

    expect(mockFetch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const callUrl = mockFetch.mock.calls[0]?.[0] as string
    expect(callUrl).toContain('/api/search?')
    expect(callUrl).toContain('hello')

    await waitFor(() => {
      expect(screen.getByText('ex')).toBeInTheDocument()
    })
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    vi.stubGlobal(
      'fetch',
      createMockFetch([
        {
          match: () => true,
          response: () => jsonResponse({ results: [] }),
        },
      ]),
    )

    render(Search, {
      props: {
        onOpenWiki: vi.fn(),
        onOpenEmail: vi.fn(),
        onClose,
      },
    })

    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenWiki and onClose when a wiki result is clicked', async () => {
    const onOpenWiki = vi.fn()
    const onClose = vi.fn()

    vi.stubGlobal(
      'fetch',
      createMockFetch([
        {
          match: (u) => u.startsWith('/api/search?'),
          response: () =>
            jsonResponse({
              results: [createWikiSearchResult({ path: 'ideas/x.md' })],
            }),
        },
      ]),
    )

    render(Search, {
      props: { onOpenWiki, onOpenEmail: vi.fn(), onClose },
    })

    const input = screen.getByPlaceholderText(/Search your docs and emails/i)
    await fireEvent.input(input, { target: { value: 'q' } })
    await vi.advanceTimersByTimeAsync(250)

    const excerpt = await screen.findByText('A snippet')
    const hit = excerpt.closest('button')
    expect(hit).toBeTruthy()
    await fireEvent.click(hit!)

    expect(onOpenWiki).toHaveBeenCalledWith('ideas/x.md')
    expect(onClose).toHaveBeenCalled()
  })
})
