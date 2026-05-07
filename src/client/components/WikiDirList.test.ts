import { describe, it, expect, vi, beforeEach } from 'vitest'
import WikiDirList from './WikiDirList.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'
import { createWikiSlideHeaderContext } from '@client/test/helpers/index.js'

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
            { path: 'me/ideas/note.md', name: 'note.md' },
            { path: 'me/me.md', name: 'me.md' },
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
    expect(onOpenDir).toHaveBeenCalledWith('me/ideas')

    await fireEvent.click(screen.getByRole('button', { name: /me\.md/i }))
    expect(onOpenFile).toHaveBeenCalledWith('me/me.md')
  })

  it('uses shared indicators for @handle rows at the wiki hub', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () =>
          wikiApiEnvelope([{ path: 'me/ideas/note.md', name: 'note' }], {
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
  })

  it('uses shared folder/page icons when browsing a shared wiki by handle', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (u.includes('/shared-by-handle')) {
        return {
          ok: true,
          json: async () => [
            { path: 'me/trips/beach.md', name: 'beach' },
            { path: 'me/readme.md', name: 'readme' },
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

  it('uses symlink icon for entries with outgoing shares', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () =>
          wikiApiEnvelope(
            [
              { path: 'me/ideas/note.md', name: 'note' },
              { path: 'me/topics/a.md', name: 'a' },
            ],
            {
              owned: [{ pathPrefix: 'ideas/', targetKind: 'dir' }],
            },
          ),
      } as Response
    }) as typeof fetch

    const { container } = render(WikiDirList, {
      props: { onOpenFile: vi.fn(), onOpenDir: vi.fn() },
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    const ideasRow = screen.getByRole('button', { name: /ideas/i })
    expect(ideasRow.classList.contains('wiki-dir-row--outgoing')).toBe(true)
  })

  it('claims the wiki slide header cell with stable handler refs (no fresh-payload churn)', async () => {
    const { context, cell, ref } = createWikiSlideHeaderContext()

    const onContextChange = vi.fn()
    const { rerender } = render(WikiDirList, {
      props: {
        dirPath: 'me/trips',
        onOpenFile: vi.fn(),
        onOpenDir: vi.fn(),
        onContextChange,
      },
      context,
    } as unknown as Parameters<typeof render>[1])

    await waitFor(() => {
      expect(ref.current).not.toBeNull()
    })

    expect(cell.claimed).toBe(true)
    expect(ref.current?.canShare).toBe(true)
    expect(ref.current?.shareTargetLabel).toBe('me/trips')
    expect(ref.current?.sharedIncoming).toBe(false)
    const onOpenShareRef = ref.current?.onOpenShare
    const setPageModeRef = ref.current?.setPageMode
    expect(typeof onOpenShareRef).toBe('function')

    // Re-render with a *new* `onContextChange` reference. Header handler identities must stay
    // stable across renders — the cell is claimed once during setup and only ever patched.
    const onContextChange2 = vi.fn()
    rerender({
      dirPath: 'me/trips',
      onOpenFile: vi.fn(),
      onOpenDir: vi.fn(),
      onContextChange: onContextChange2,
    })

    await waitFor(() => {
      expect(cell.claimed).toBe(true)
    })
    expect(ref.current?.onOpenShare).toBe(onOpenShareRef)
    expect(ref.current?.setPageMode).toBe(setPageModeRef)
  })

  it('uses symlink icon when duplicate grant rows share the same prefix', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () =>
          wikiApiEnvelope([{ path: 'me/trips/beach.md', name: 'beach' }], {
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

    const beachRow = screen.getByRole('button', { name: /beach/i })
    expect(beachRow.classList.contains('wiki-dir-row--outgoing')).toBe(true)
  })
})
