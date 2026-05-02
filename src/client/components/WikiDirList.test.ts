import { describe, it, expect, vi, beforeEach } from 'vitest'
import WikiDirList from './WikiDirList.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'

function wikiApiEnvelope(files: { path: string; name: string }[], shares?: {
  owned?: { pathPrefix: string; targetKind: 'dir' | 'file' }[]
  received?: {
    id: string
    ownerId: string
    ownerHandle: string
    pathPrefix: string
    targetKind?: 'dir' | 'file'
  }[]
}) {
  return {
    files,
    shares: {
      owned: shares?.owned ?? [],
      received: shares?.received ?? [],
    },
  }
}

describe('WikiDirList.svelte', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () =>
          wikiApiEnvelope([
            { path: 'ideas/note.md', name: 'note.md' },
            { path: 'me.md', name: 'me.md' },
          ]),
      } as Response
    }) as typeof fetch
  })

  it('loads wiki list and navigates folder vs file', async () => {
    const onOpenFile = vi.fn()
    const onOpenDir = vi.fn()

    render(WikiDirList, {
      props: { onOpenFile, onOpenDir },
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    await fireEvent.click(screen.getByRole('button', { name: /ideas/i }))
    expect(onOpenDir).toHaveBeenCalledWith('ideas')

    await fireEvent.click(screen.getByRole('button', { name: /me\.md/i }))
    expect(onOpenFile).toHaveBeenCalledWith('me.md')
  })

  it('uses shared indicators for @handle rows at the wiki hub', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () =>
          wikiApiEnvelope([{ path: 'ideas/note.md', name: 'note' }], {
            received: [
              {
                id: 'wsh_1',
                ownerId: 'usr_alice',
                ownerHandle: 'alice',
                pathPrefix: 'trips/',
                targetKind: 'dir' as const,
              },
            ],
          }),
      } as Response
    }) as typeof fetch

    const { container } = render(WikiDirList, {
      props: {
        onOpenFile: vi.fn(),
        onOpenDir: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    const sharedRows = container.querySelectorAll('.wiki-dir-row--shared')
    expect(sharedRows.length).toBe(1)
    expect(screen.getByRole('button', { name: /@alice/i })).toBeTruthy()
    expect(screen.getByText('Shared wiki')).toBeInTheDocument()
  })

  it('uses shared folder/page icons when browsing a shared wiki by handle', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (u.includes('/shared-by-handle')) {
        return {
          ok: true,
          json: async () => [
            { path: 'trips/beach.md', name: 'beach' },
            { path: 'readme.md', name: 'readme' },
          ],
        } as Response
      }
      return { ok: true, json: async () => wikiApiEnvelope([]) } as Response
    }) as typeof fetch

    const { container } = render(WikiDirList, {
      props: {
        onOpenFile: vi.fn(),
        onOpenDir: vi.fn(),
        shareHandle: 'alice',
      },
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    expect(container.querySelectorAll('.wiki-dir-row--shared').length).toBe(2)
  })

  it('shows outgoing share audience count on rows when shares cover subtree', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () =>
          wikiApiEnvelope(
            [
              { path: 'ideas/note.md', name: 'note' },
              { path: 'topics/a.md', name: 'a' },
            ],
            {
              owned: [{ pathPrefix: 'ideas/', targetKind: 'dir' }],
            },
          ),
      } as Response
    }) as typeof fetch

    render(WikiDirList, {
      props: { onOpenFile: vi.fn(), onOpenDir: vi.fn() },
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    expect(screen.getByLabelText(/Shared with 1 people/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ideas/i })).toBeTruthy()
  })

  it('shows audience badge count when duplicate grant rows share the same prefix', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () =>
          wikiApiEnvelope([{ path: 'trips/beach.md', name: 'beach' }], {
            owned: [
              { pathPrefix: 'trips/', targetKind: 'dir' },
              { pathPrefix: 'trips/', targetKind: 'dir' },
            ],
          }),
      } as Response
    }) as typeof fetch

    render(WikiDirList, {
      props: {
        dirPath: 'me/trips',
        onOpenFile: vi.fn(),
        onOpenDir: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    expect(screen.getByLabelText(/Shared with 2 people/i)).toBeInTheDocument()
  })
})
