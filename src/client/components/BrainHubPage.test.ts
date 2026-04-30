import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@client/test/render.js'
import { fetchVaultStatus } from '@client/lib/vaultClient.js'
import BrainHubPage from './BrainHubPage.svelte'

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
  yourWikiDocFromEvents: { subscribe: vi.fn(() => () => {}) },
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
})
