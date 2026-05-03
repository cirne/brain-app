import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@client/test/render.js'
import BrainSettingsPage from './BrainSettingsPage.svelte'
import * as wikiSharesClient from '@client/lib/wikiSharesClient.js'

function requestUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

vi.mock('@client/lib/vaultClient.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@client/lib/vaultClient.js')>()
  return {
    ...mod,
    fetchVaultStatus: vi.fn(() =>
      Promise.resolve({
        unlocked: true,
        multiTenant: true,
        handleConfirmed: true,
        workspaceHandle: 'testuser',
      }),
    ),
    postVaultLogout: vi.fn(() => Promise.resolve()),
    postVaultDeleteAllData: vi.fn(() => Promise.resolve({})),
  }
})

vi.mock('@client/lib/app/appEvents.js', () => ({
  subscribe: vi.fn(() => () => {}),
  emit: vi.fn(),
}))

function defaultFetchHandler(): typeof fetch {
  return vi.fn((url: RequestInfo | URL) => {
    const u = requestUrlString(url)
    if (u.includes('/api/hub/sources/mail-prefs')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ ok: true, mailboxes: [], defaultSendSource: null }),
          { status: 200 },
        ),
      )
    }
    if (u.includes('/api/hub/sources/detail')) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: 'not used in settings test' }), {
          status: 200,
        }),
      )
    }
    if (u.includes('/api/hub/sources')) {
      return Promise.resolve(new Response(JSON.stringify({ sources: [] }), { status: 200 }))
    }
    if (u.includes('/api/wiki-shares')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ owned: [], received: [], pendingReceived: [] }),
          { status: 200 },
        ),
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }) as unknown as typeof fetch
}

describe('BrainSettingsPage.svelte', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', defaultFetchHandler())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/settings')
    }
  })

  it('shows Settings title and handle', async () => {
    render(BrainSettingsPage, {
      props: { onSettingsNavigate: vi.fn() },
    })
    expect(screen.getByRole('heading', { level: 1, name: /settings/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('@testuser')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Connections' })).toBeInTheDocument()
    })
  })

  it('shows banner and strips add-account query on /settings', async () => {
    window.history.replaceState(null, '', '/settings?addedAccount=second%40example.com')
    render(BrainSettingsPage, {
      props: { onSettingsNavigate: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByText(/Added second@example\.com/i)).toBeInTheDocument()
    })
    expect(window.location.search).toBe('')
  })

  it('renders Add another Gmail account row', async () => {
    render(BrainSettingsPage, {
      props: { onSettingsNavigate: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByText(/Add another Gmail account/i)).toBeInTheDocument()
    })
  })

  it('renders chat tool display preference and persists when toggled', async () => {
    const store: Record<string, string> = {}
    vi.stubGlobal(
      'localStorage',
      {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v
        },
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: vi.fn(),
        length: 0,
      } as Storage,
    )
    render(BrainSettingsPage, {
      props: { onSettingsNavigate: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Chat' })).toBeInTheDocument()
    })
    const compactRadio = screen.getByRole('radio', { name: /^compact\b/i })
    const detailedRadio = screen.getByRole('radio', { name: /^detailed\b/i })
    expect(compactRadio).toBeChecked()
    await fireEvent.click(detailedRadio)
    expect(store['brain.chat.toolDisplay']).toBe('detailed')
    expect(detailedRadio).toBeChecked()
  })

  it('navigates to hub-source when a source row is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo) => {
        const u = String(url)
        if (u.includes('/api/hub/sources/mail-prefs')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ ok: true, mailboxes: [], defaultSendSource: null }),
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
                ],
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as unknown as typeof fetch,
    )
    const onSettingsNavigate = vi.fn()
    render(BrainSettingsPage, {
      props: { onSettingsNavigate },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /work@example\.com/i })).toBeInTheDocument()
    })
    await fireEvent.click(screen.getByRole('button', { name: /work@example\.com/i }))
    expect(onSettingsNavigate).toHaveBeenCalledWith({ type: 'hub-source', id: 'work_x' })
  })

  it('marks the hub source row as selected when selectedHubSourceId matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo) => {
        const u = String(url)
        if (u.includes('/api/hub/sources/mail-prefs')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ ok: true, mailboxes: [], defaultSendSource: null }),
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
                    id: 'mail_a',
                    kind: 'imap',
                    displayName: 'a@example.com',
                    path: null,
                  },
                  {
                    id: 'cal_b',
                    kind: 'googleCalendar',
                    displayName: 'b@example.com',
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
    render(BrainSettingsPage, {
      props: { onSettingsNavigate: vi.fn(), selectedHubSourceId: 'cal_b' },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /b@example\.com/i })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
    expect(screen.getByRole('button', { name: /a@example\.com/i })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('shows Google Drive label for googleDrive sources', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo) => {
        const u = String(url)
        if (u.includes('/api/hub/sources/mail-prefs')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ ok: true, mailboxes: [], defaultSendSource: null }),
              { status: 200 },
            ),
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
                    id: 'gd1',
                    kind: 'googleDrive',
                    displayName: 'you@gmail.com',
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
    render(BrainSettingsPage, {
      props: { onSettingsNavigate: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument()
    })
  })

  it('Sharing section lists pending invitations with Accept', async () => {
    vi.spyOn(wikiSharesClient, 'fetchWikiSharesList').mockResolvedValue({
      owned: [],
      received: [],
      pendingReceived: [
        {
          id: 'wsh_pend',
          ownerId: 'usr_alice',
          ownerHandle: 'alice',
          granteeEmail: 'me@example.com',
          granteeId: 'usr_me_test',
          pathPrefix: 'notes/',
          targetKind: 'dir',
          createdAtMs: Date.now(),
          acceptedAtMs: null,
          revokedAtMs: null,
        },
      ],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL) => {
        const u = requestUrlString(url)
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
      }) as unknown as typeof fetch,
    )
    render(BrainSettingsPage, {
      props: { onSettingsNavigate: vi.fn(), onNavigateToSharedWiki: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sharing' })).toBeInTheDocument()
    })
    expect(screen.getByText('Invitations')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(screen.getByText(/@alice/i)).toBeInTheDocument()
  })

  it('Sharing owned row Manage opens WikiShare dialog for that path', async () => {
    const ownedFileRow = {
      id: 'wsh_own_file',
      ownerId: 'usr_me',
      ownerHandle: 'me',
      granteeEmail: 'cirne@gamaliel.ai',
      granteeId: 'usr_grantee_cirne',
      pathPrefix: 'travel/virginia-trip-2026.md',
      targetKind: 'file' as const,
      createdAtMs: Date.now(),
      acceptedAtMs: null,
      revokedAtMs: null,
    }
    vi.spyOn(wikiSharesClient, 'fetchWikiSharesList').mockResolvedValue({
      owned: [ownedFileRow],
      received: [],
      pendingReceived: [],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const u = requestUrlString(input)
        const method = (init?.method ?? 'GET').toUpperCase()
        const pathname = new URL(u, 'http://localhost.test').pathname
        const wikiSharesListGet = pathname === '/api/wiki-shares' && method === 'GET'

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
        if (wikiSharesListGet) {
          return Promise.resolve(
            new Response(JSON.stringify({ owned: [ownedFileRow], received: [], pendingReceived: [] }), {
              status: 200,
            }),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as unknown as typeof fetch,
    )

    render(BrainSettingsPage, {
      props: { onSettingsNavigate: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument()
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Share this page' })).toBeInTheDocument()
      expect(screen.getByText('Who has access')).toBeInTheDocument()
    })
  })

  it('What you’ve shared title navigates to local wiki file in settings overlay', async () => {
    const ownedFileRow = {
      id: 'wsh_own_nav',
      ownerId: 'usr_me',
      ownerHandle: 'me',
      granteeEmail: 'peer@example.com',
      granteeId: 'usr_peer',
      pathPrefix: 'travel/virginia-trip-2026.md',
      targetKind: 'file' as const,
      createdAtMs: Date.now(),
      acceptedAtMs: Date.now(),
      revokedAtMs: null,
    }
    vi.spyOn(wikiSharesClient, 'fetchWikiSharesList').mockResolvedValue({
      owned: [ownedFileRow],
      received: [],
      pendingReceived: [],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const u = requestUrlString(input)
        const method = (init?.method ?? 'GET').toUpperCase()
        const pathname = new URL(u, 'http://localhost.test').pathname
        const wikiSharesListGet = pathname === '/api/wiki-shares' && method === 'GET'
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
        if (wikiSharesListGet) {
          return Promise.resolve(
            new Response(JSON.stringify({ owned: [ownedFileRow], received: [], pendingReceived: [] }), {
              status: 200,
            }),
          )
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as unknown as typeof fetch,
    )

    const onSettingsNavigate = vi.fn()
    render(BrainSettingsPage, {
      props: { onSettingsNavigate, onNavigateToSharedWiki: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^open page:/i })).toBeInTheDocument()
    })
    await fireEvent.click(screen.getByRole('button', { name: /^open page:/i }))
    expect(onSettingsNavigate).toHaveBeenCalledWith({
      type: 'wiki',
      path: 'travel/virginia-trip-2026.md',
    })
  })
})
