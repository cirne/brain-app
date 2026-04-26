import { describe, it, expect, vi, beforeEach } from 'vitest'
import Wiki from './Wiki.svelte'
import { screen, waitFor } from '@client/test/render.js'
import { createMockFetch } from '@client/test/mocks/fetch.js'
import { createWikiList } from '@client/test/fixtures/wiki.js'
import * as appEvents from '@client/lib/app/appEvents.js'
import {
  renderWithWikiSlideHeader,
  stubAppEventsEmit,
  wikiListAndPageHandlers,
} from '@client/test/helpers/index.js'

vi.mock('./TipTapMarkdownEditor.svelte', () => import('./test-stubs/TipTapMarkdownEditorStub.svelte'))

describe('Wiki.svelte', () => {
  beforeEach(() => {
    stubAppEventsEmit()
  })

  it('loads file list and opens initialPath with rendered html', async () => {
    const files = createWikiList(['ideas/note.md'])
    const path = 'ideas/note.md'

    const mockFetch = createMockFetch(wikiListAndPageHandlers({ files, path }))
    vi.stubGlobal('fetch', mockFetch)

    renderWithWikiSlideHeader(Wiki, {
      props: { initialPath: path },
    })

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument()
    })
  })

  it('PATCHes markdown when leaving edit mode (flushSave)', async () => {
    const files = createWikiList(['ideas/note.md'])
    const path = 'ideas/note.md'

    const patch = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
    )

    const mockFetch = createMockFetch(
      wikiListAndPageHandlers({
        files,
        path,
        page: { html: '<p>Hello</p>', raw: '# Hello', meta: {} },
        patch,
      }),
    )
    vi.stubGlobal('fetch', mockFetch)

    const { wikiHeaderRef } = renderWithWikiSlideHeader(Wiki, {
      props: { initialPath: path },
    })

    await waitFor(() => {
      expect(wikiHeaderRef.current?.canEdit).toBe(true)
    })

    wikiHeaderRef.current!.setPageMode('edit')

    await waitFor(() => {
      expect(screen.getByTestId('tiptap-editor-stub')).toBeInTheDocument()
    })

    await wikiHeaderRef.current!.setPageMode('view')

    await waitFor(() => {
      expect(patch).toHaveBeenCalled()
    })

    const patchCall = patch.mock.calls[0] as [string, RequestInit | undefined] | undefined
    expect(patchCall?.[1]?.method).toBe('PATCH')
    expect(appEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'wiki:mutated', source: 'user' }),
    )
  })
})
