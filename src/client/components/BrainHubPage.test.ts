import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@client/test/render.js'
import { fetchVaultStatus } from '@client/lib/vaultClient.js'
import type { BackgroundAgentDoc } from '@client/lib/statusBar/backgroundAgentTypes.js'
import BrainHubPage from './BrainHubPage.svelte'

const hubStoreTest = vi.hoisted(() => {
  let wikiDoc: BackgroundAgentDoc | null = null
  return {
    setWikiDoc(doc: BackgroundAgentDoc | null) {
      wikiDoc = doc
    },
    yourWikiDocFromEvents: {
      subscribe(fn: (d: BackgroundAgentDoc) => void) {
        if (wikiDoc) fn(wikiDoc)
        return () => {}
      },
    },
  }
})
vi.mock('@client/lib/vaultClient.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@client/lib/vaultClient.js')>()
  return {
    ...mod,
    fetchVaultStatus: vi.fn(() =>
      Promise.resolve({
        vaultExists: true,
        unlocked: true,
        multiTenant: true,
        handleConfirmed: true,
        workspaceHandle: 'testuser',
      }),
    ),
  }
})

vi.mock('@client/lib/app/appEvents.js', () => ({
  subscribe: vi.fn(() => () => {}),
  emit: vi.fn(),
}))

vi.mock('@client/lib/hubEvents/hubEventsStores.js', () => ({
  yourWikiDocFromEvents: hubStoreTest.yourWikiDocFromEvents,
}))

function defaultFetchHandler(): typeof fetch {
  return vi.fn((url: RequestInfo) => {
    const u = String(url)
    if (u.includes('/api/wiki/edit-history')) {
      return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }))
    }
    if (u.includes('/api/wiki/recent')) {
      return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }))
    }
    if (u.includes('/api/wiki') && !u.includes('edit-history') && !u.includes('recent')) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }
    if (u.includes('/api/inbox/mail-sync-status')) {
      return Promise.resolve(
        new Response(JSON.stringify({ indexedTotal: 0, configured: false }), { status: 200 }),
      )
    }
    if (u.includes('/api/hub/sources/detail')) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: 'not used in hub page test' }), {
          status: 200,
        }),
      )
    }
    if (u.includes('/api/hub/sources')) {
      return Promise.resolve(new Response(JSON.stringify({ sources: [] }), { status: 200 }))
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }) as unknown as typeof fetch
}

describe('BrainHubPage.svelte (Activity)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', defaultFetchHandler())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    hubStoreTest.setWikiDoc(null)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/hub')
    }
  })

  it('shows Activity title and hosted workspace handle', async () => {
    render(BrainHubPage, { props: { onHubNavigate: vi.fn() } })

    expect(screen.getByRole('heading', { level: 1, name: /activity/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('@testuser')).toBeInTheDocument()
    })
  })

  it('shows Search index section with aggregate summary when sources exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo) => {
        const u = String(url)
        if (u.includes('/api/wiki/edit-history') || u.includes('/api/wiki/recent')) {
          return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }))
        }
        if (u.includes('/api/wiki') && !u.includes('edit-history') && !u.includes('recent')) {
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }
        if (u.includes('/api/inbox/mail-sync-status')) {
          return Promise.resolve(
            new Response(JSON.stringify({ indexedTotal: 2, configured: true }), { status: 200 }),
          )
        }
        if (u.includes('/api/hub/sources/detail')) {
          return Promise.resolve(
            new Response(JSON.stringify({ ok: false, error: 'not used' }), { status: 200 }),
          )
        }
        if (u.includes('/api/hub/sources')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                sources: [
                  {
                    id: 'a',
                    kind: 'imap',
                    displayName: 'you@example.com',
                    path: null,
                  },
                ],
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as unknown as typeof fetch,
    )

    render(BrainHubPage, { props: { onHubNavigate: vi.fn() } })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^search index$/i })).toBeInTheDocument()
      expect(screen.getByText(/Feeding this index/i)).toBeInTheDocument()
      expect(screen.getByText(/1 mailbox/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Add another Gmail account/i })).not.toBeInTheDocument()
  })

  it('Settings in Search index lead is a link that calls onOpenSettings when wired', async () => {
    const onOpenSettings = vi.fn()
    render(BrainHubPage, { props: { onHubNavigate: vi.fn(), onOpenSettings } })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^search index$/i })).toBeInTheDocument()
    })

    const link = screen.getByRole('link', { name: /^settings$/i })
    expect(link).toHaveAttribute('href', '/settings')
    await fireEvent.click(link)
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('shows Pause when wiki loop is active and POSTs /api/your-wiki/pause on click', async () => {
    hubStoreTest.setWikiDoc({
      id: 'your-wiki',
      kind: 'your-wiki',
      status: 'running',
      label: 'Your Wiki',
      detail: '',
      pageCount: 3,
      logLines: [],
      startedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      phase: 'enriching',
    })

    const baseFetch = defaultFetchHandler()
    const fetchMock = vi.fn((url: RequestInfo, init?: RequestInit) => {
      const u = String(url)
      if (u === '/api/your-wiki/pause') {
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      return baseFetch(url, init)
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    render(BrainHubPage, { props: { onHubNavigate: vi.fn() } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument()
    })
    await fireEvent.click(screen.getByRole('button', { name: /^pause$/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/your-wiki/pause', { method: 'POST' })
    })
  })
})
