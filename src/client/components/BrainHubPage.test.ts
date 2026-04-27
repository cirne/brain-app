import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@client/test/render.js'
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
    if (u.includes('/api/onboarding/mail')) {
      return Promise.resolve(
        new Response(JSON.stringify({ indexedTotal: 0, configured: false }), { status: 200 }),
      )
    }
    if (u.includes('/api/hub/sources/mail-prefs')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, mailboxes: [], defaultSendSource: null }),
          { status: 200 },
        ),
      )
    }
    if (u.includes('/api/hub/sources')) {
      return Promise.resolve(new Response(JSON.stringify({ sources: [] }), { status: 200 }))
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }) as unknown as typeof fetch
}

describe('BrainHubPage.svelte', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', defaultFetchHandler())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/hub')
    }
  })

  it('shows hosted workspace handle under the page title', async () => {
    render(BrainHubPage, { props: { onHubNavigate: vi.fn() } })

    expect(screen.getByRole('heading', { level: 1, name: /braintunnel hub/i })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('@testuser')).toBeInTheDocument()
    })
  })

  it('renders an Add another Gmail account row', async () => {
    render(BrainHubPage, { props: { onHubNavigate: vi.fn() } })
    await waitFor(() => {
      expect(screen.getByText(/Add another Gmail account/i)).toBeInTheDocument()
    })
  })

  it('shows a banner when the URL contains addedAccount and strips the param', async () => {
    window.history.replaceState(null, '', '/hub?addedAccount=second%40example.com')
    render(BrainHubPage, { props: { onHubNavigate: vi.fn() } })
    await waitFor(() => {
      expect(screen.getByText(/Added second@example\.com/i)).toBeInTheDocument()
    })
    expect(window.location.search).toBe('')
  })

  it('shows an error banner when the URL contains addAccountError', async () => {
    window.history.replaceState(null, '', '/hub?addAccountError=Could%20not%20link%20account')
    render(BrainHubPage, { props: { onHubNavigate: vi.fn() } })
    await waitFor(() => {
      expect(screen.getByText(/Could not link account/i)).toBeInTheDocument()
    })
  })

  it('renders default-send and hidden-from-search pills based on mail-prefs', async () => {
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
        if (u.includes('/api/onboarding/mail')) {
          return Promise.resolve(
            new Response(JSON.stringify({ indexedTotal: 0, configured: true }), { status: 200 }),
          )
        }
        if (u.includes('/api/hub/sources/mail-prefs')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                mailboxes: [
                  { id: 'work_x', email: 'work@example.com', includeInDefault: true },
                  { id: 'personal_x', email: 'personal@example.com', includeInDefault: false },
                ],
                defaultSendSource: 'work_x',
              }),
              { status: 200 },
            ),
          )
        }
        if (u.includes('/api/hub/sources')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                sources: [
                  {
                    id: 'work_x',
                    kind: 'imap',
                    displayName: 'work@example.com',
                    path: null,
                  },
                  {
                    id: 'personal_x',
                    kind: 'imap',
                    displayName: 'personal@example.com',
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
      expect(screen.getByText('Default send')).toBeInTheDocument()
    })
    expect(screen.getByText('Hidden from search')).toBeInTheDocument()
  })
})
