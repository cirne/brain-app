import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@client/test/render.js'
import SettingsConnectionsPage from './SettingsConnectionsPage.svelte'

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
        multiTenant: false,
      }),
    ),
  }
})

vi.mock('@client/lib/app/appEvents.js', () => ({
  subscribe: vi.fn(() => () => {}),
  emit: vi.fn(),
}))

function defaultFetch(): typeof fetch {
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
    if (u.includes('/api/hub/sources')) {
      return Promise.resolve(new Response(JSON.stringify({ sources: [] }), { status: 200 }))
    }
    if (u.includes('/api/slack/connection')) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, oauthConfigured: false, workspaces: [] }), {
          status: 200,
        }),
      )
    }
    return Promise.resolve(new Response('not found', { status: 404 }))
  }) as unknown as typeof fetch
}

describe('SettingsConnectionsPage.svelte', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', defaultFetch())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders Add another Google account row', async () => {
    render(SettingsConnectionsPage, {
      props: {
        onSettingsNavigate: vi.fn(),
        onNavigateToSettingsRoot: vi.fn(),
      },
    })
    await waitFor(() => {
      expect(screen.getByText(/Add another Google account/i)).toBeInTheDocument()
    })
  })

  it('navigates to hub-source when a source row is clicked', async () => {
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
    render(SettingsConnectionsPage, {
      props: { onSettingsNavigate, onNavigateToSettingsRoot: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /work@example\.com/i })).toBeInTheDocument()
    })
    await fireEvent.click(screen.getByRole('button', { name: /work@example\.com/i }))
    expect(onSettingsNavigate).toHaveBeenCalledWith({ type: 'hub-source', id: 'work_x' })
  })

  it('marks the Google account row as selected when selectedGoogleAccountEmail matches', async () => {
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
          return Promise.resolve(
            new Response(
              JSON.stringify({
                sources: [
                  {
                    id: 'mail_a',
                    kind: 'imap',
                    displayName: 'b@example.com',
                    path: null,
                    oauthSourceId: 'oauth-b',
                    email: 'b@example.com',
                  },
                  {
                    id: 'cal_b',
                    kind: 'googleCalendar',
                    displayName: 'b@example.com',
                    path: null,
                    oauthSourceId: 'oauth-b',
                    email: 'b@example.com',
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
    render(SettingsConnectionsPage, {
      props: {
        onSettingsNavigate: vi.fn(),
        selectedGoogleAccountEmail: 'b@example.com',
        onNavigateToSettingsRoot: vi.fn(),
      },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /b@example\.com/i })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
  })

  it('navigates to google-account when a bundled Google row is clicked', async () => {
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
          return Promise.resolve(
            new Response(
              JSON.stringify({
                sources: [
                  {
                    id: 'mail_a',
                    kind: 'imap',
                    displayName: 'merge@example.com',
                    path: null,
                    oauthSourceId: 'oauth-m',
                    email: 'merge@example.com',
                  },
                  {
                    id: 'cal_b',
                    kind: 'googleCalendar',
                    displayName: 'merge@example.com',
                    path: null,
                    oauthSourceId: 'oauth-m',
                    email: 'merge@example.com',
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
    render(SettingsConnectionsPage, {
      props: { onSettingsNavigate, onNavigateToSettingsRoot: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /merge@example\.com/i })).toBeInTheDocument()
    })
    await fireEvent.click(screen.getByRole('button', { name: /merge@example\.com/i }))
    expect(onSettingsNavigate).toHaveBeenCalledWith({
      type: 'google-account',
      email: 'merge@example.com',
    })
  })

  it('shows Google Drive label for googleDrive sources', async () => {
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
    render(SettingsConnectionsPage, {
      props: { onSettingsNavigate: vi.fn(), onNavigateToSettingsRoot: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument()
    })
  })

  it('shows muted Slack setup when oauth is not configured', async () => {
    render(SettingsConnectionsPage, {
      props: { onSettingsNavigate: vi.fn(), onNavigateToSettingsRoot: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByText(/Slack is not set up on this server/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Connect another Slack workspace/i)).not.toBeInTheDocument()
  })

  it('renders Slack workspace row and navigates to slack-workspace overlay', async () => {
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
        if (u.includes('/api/slack/connection')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                oauthConfigured: true,
                workspaces: [
                  {
                    slackTeamId: 'TEAM_ABC',
                    teamName: 'Acme HQ',
                    workspaceConnected: true,
                    userLinked: true,
                    slackUserId: 'U123',
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
    render(SettingsConnectionsPage, {
      props: { onSettingsNavigate, onNavigateToSettingsRoot: vi.fn() },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Acme HQ/i })).toBeInTheDocument()
    })
    expect(screen.getByText(/Connect another Slack workspace/i)).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /Acme HQ/i }))
    expect(onSettingsNavigate).toHaveBeenCalledWith({ type: 'slack-workspace', teamId: 'TEAM_ABC' })
  })

  it('marks Slack workspace selected when selectedSlackTeamId matches', async () => {
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
        if (u.includes('/api/slack/connection')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                oauthConfigured: true,
                workspaces: [
                  {
                    slackTeamId: 'TSEL',
                    teamName: 'Selected WS',
                    workspaceConnected: true,
                    userLinked: true,
                    slackUserId: 'U999',
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
    render(SettingsConnectionsPage, {
      props: {
        onSettingsNavigate: vi.fn(),
        selectedSlackTeamId: 'TSEL',
        onNavigateToSettingsRoot: vi.fn(),
      },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Selected WS/i })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
  })
})
