import { describe, it, expect, vi, beforeEach } from 'vitest'
import Wiki from './Wiki.svelte'
import { screen, waitFor } from '@client/test/render.js'
import { createMockFetch, jsonResponse } from '@client/test/mocks/fetch.js'
import { createWikiList } from '@client/test/fixtures/wiki.js'
import { encodeWikiPathSegmentsForUrl } from '@client/lib/wikiPageHtml.js'
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
      expect(screen.getByTestId('tiptap-editor-stub')).toHaveTextContent('# Hello')
    })
  })

  it('PATCHes markdown via flushSavingMarkdown (always-on TipTap flush)', async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId('tiptap-editor-stub')).toBeInTheDocument()
    })

    await wikiHeaderRef.current!.flushSavingMarkdown?.()

    await waitFor(() => {
      expect(patch).toHaveBeenCalled()
    })

    const patchCall = patch.mock.calls[0] as [string, RequestInit | undefined] | undefined
    expect(patchCall?.[1]?.method).toBe('PATCH')
    expect(appEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'wiki:mutated', source: 'user' }),
    )
  })

  it('clears loading when refreshKey refresh aborts the initial open fetch', async () => {
    const files = createWikiList(['ideas/note.md'])
    const path = 'ideas/note.md'
    const enc = encodeWikiPathSegmentsForUrl(path)
    const pageUrl = `/api/wiki/${enc}`
    const page = { html: '<p>Hello</p>', raw: '# Hello', meta: { title: 'Note' } }
    let pageGetCount = 0

    const mockFetch = createMockFetch([
      {
        match: (u) => u === '/api/wiki',
        response: () =>
          jsonResponse({
            files,
            shares: { owned: [] as const, received: [] as const },
          }),
      },
      {
        match: (u, init) =>
          u === pageUrl && (init?.method ?? 'GET') === 'GET',
        response: async (_u, init) => {
          pageGetCount += 1
          if (pageGetCount === 1) {
            await new Promise<void>((_resolve, reject) => {
              const sig = init?.signal
              if (!sig) {
                reject(new Error('expected AbortSignal on wiki page GET'))
                return
              }
              if (sig.aborted) {
                reject(new DOMException('Aborted', 'AbortError'))
                return
              }
              sig.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                once: true,
              })
            })
          }
          return jsonResponse(page)
        },
      },
    ])
    vi.stubGlobal('fetch', mockFetch)

    const { rerender } = renderWithWikiSlideHeader(Wiki, {
      props: { initialPath: path, refreshKey: 0 },
    })

    await waitFor(() => {
      expect(mockFetch.mock.calls.some((c) => String(c[0]) === pageUrl)).toBe(true)
    })
    rerender({ initialPath: path, refreshKey: 1 })

    await waitFor(() => {
      expect(screen.getByTestId('tiptap-editor-stub')).toHaveTextContent('# Hello')
    })
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    expect(pageGetCount).toBe(2)
  })

  it('shows empty wiki shell when route has no file path', async () => {
    vi.stubGlobal(
      'fetch',
      createMockFetch([
        {
          match: (u) => u === '/api/wiki',
          response: () =>
            jsonResponse({
              files: createWikiList(['ideas/note.md']),
              shares: { owned: [], received: [] },
            }),
        },
      ]),
    )

    renderWithWikiSlideHeader(Wiki, {
      props: { initialPath: '', refreshKey: 0 },
    })

    await waitFor(() => {
      expect(screen.getByText('No page selected')).toBeInTheDocument()
    })

    vi.unstubAllGlobals()
  })
})
