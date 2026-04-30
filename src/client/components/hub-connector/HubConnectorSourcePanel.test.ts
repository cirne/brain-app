import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@client/test/render.js'
import HubConnectorSourcePanel from './HubConnectorSourcePanel.svelte'

vi.mock('@client/lib/app/appEvents.js', () => ({
  emit: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}))

type FetchMock = (url: RequestInfo, init?: RequestInit) => Promise<Response>

function makeFetch(handler: FetchMock): typeof fetch {
  return vi.fn(handler) as unknown as typeof fetch
}

describe('HubConnectorSourcePanel.svelte preferences', () => {
  beforeEach(() => {
    // jsdom: fetch defaults are scoped per test
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function commonGet(u: string): Response | null {
    if (u.includes('/api/hub/sources/mail-status')) {
      return new Response(
        JSON.stringify({
          ok: true,
          sourceId: 'work_x',
          mailbox: null,
          index: {
            totalIndexed: 0,
            syncRunning: false,
            staleLockInDb: false,
            refreshRunning: false,
            backfillRunning: false,
            lastSyncAt: null,
            lastSyncAgoHuman: null,
          },
        }),
        { status: 200 },
      )
    }
    return null
  }

  function sourcesResponse(): Response {
    return new Response(
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
    )
  }

  it('renders the two preference toggles for IMAP sources only', async () => {
    let prefsState: {
      defaultSendSource: string | null
      mailboxes: { id: string; email: string; includeInDefault: boolean }[]
    } = {
      defaultSendSource: null,
      mailboxes: [{ id: 'work_x', email: 'work@example.com', includeInDefault: true }],
    }
    vi.stubGlobal(
      'fetch',
      makeFetch(async (url) => {
        const u = String(url)
        if (u.endsWith('/api/hub/sources') || u.includes('/api/hub/sources?')) {
          return sourcesResponse()
        }
        if (u.includes('/api/hub/sources/mail-prefs')) {
          return new Response(JSON.stringify({ ok: true, ...prefsState }), { status: 200 })
        }
        const r = commonGet(u)
        if (r) return r
        return new Response('not found', { status: 404 })
      }),
    )

    render(HubConnectorSourcePanel, { props: { sourceId: 'work_x', onClose: () => {} } })

    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', { name: /Search this mailbox by default/i }),
      ).toBeInTheDocument()
    })
    expect(
      screen.getByRole('checkbox', { name: /Send from this mailbox by default/i }),
    ).toBeInTheDocument()
    void prefsState
  })

  it('toggling search visibility posts include-in-default and reflects the new value', async () => {
    let prefsState = {
      defaultSendSource: null as string | null,
      mailboxes: [{ id: 'work_x', email: 'work@example.com', includeInDefault: true }],
    }
    const seenPosts: { url: string; body: string }[] = []
    vi.stubGlobal(
      'fetch',
      makeFetch(async (url, init) => {
        const u = String(url)
        if (init?.method === 'POST' && u.includes('/api/hub/sources/include-in-default')) {
          const body = init.body as string
          seenPosts.push({ url: u, body })
          const parsed = JSON.parse(body) as { id: string; included: boolean }
          prefsState.mailboxes = prefsState.mailboxes.map((m) =>
            m.id === parsed.id ? { ...m, includeInDefault: parsed.included } : m,
          )
          return new Response(
            JSON.stringify({ ok: true, id: parsed.id, includeInDefault: parsed.included }),
            { status: 200 },
          )
        }
        if (u.endsWith('/api/hub/sources') || u.includes('/api/hub/sources?')) {
          return sourcesResponse()
        }
        if (u.includes('/api/hub/sources/mail-prefs')) {
          return new Response(JSON.stringify({ ok: true, ...prefsState }), { status: 200 })
        }
        const r = commonGet(u)
        if (r) return r
        return new Response('not found', { status: 404 })
      }),
    )

    render(HubConnectorSourcePanel, { props: { sourceId: 'work_x', onClose: () => {} } })

    const checkbox = await screen.findByRole('checkbox', {
      name: /Search this mailbox by default/i,
    })
    await waitFor(() => {
      expect(checkbox).not.toBeDisabled()
    })
    expect(checkbox).toBeChecked()

    await fireEvent.click(checkbox)

    await waitFor(() => {
      expect(seenPosts.length).toBe(1)
    })
    const sent = JSON.parse(seenPosts[0].body) as { id: string; included: boolean }
    expect(sent).toEqual({ id: 'work_x', included: false })
  })

  it('toggling default send posts the source id, then clears it on a second click', async () => {
    let prefsState = {
      defaultSendSource: null as string | null,
      mailboxes: [{ id: 'work_x', email: 'work@example.com', includeInDefault: true }],
    }
    const seenPosts: { url: string; body: string }[] = []
    vi.stubGlobal(
      'fetch',
      makeFetch(async (url, init) => {
        const u = String(url)
        if (init?.method === 'POST' && u.includes('/api/hub/sources/default-send')) {
          const body = init.body as string
          seenPosts.push({ url: u, body })
          const parsed = JSON.parse(body) as { id: string }
          prefsState.defaultSendSource = parsed.id ? parsed.id : null
          return new Response(
            JSON.stringify({ ok: true, defaultSendSource: prefsState.defaultSendSource }),
            { status: 200 },
          )
        }
        if (u.endsWith('/api/hub/sources') || u.includes('/api/hub/sources?')) {
          return sourcesResponse()
        }
        if (u.includes('/api/hub/sources/mail-prefs')) {
          return new Response(JSON.stringify({ ok: true, ...prefsState }), { status: 200 })
        }
        const r = commonGet(u)
        if (r) return r
        return new Response('not found', { status: 404 })
      }),
    )

    render(HubConnectorSourcePanel, { props: { sourceId: 'work_x', onClose: () => {} } })

    const checkbox = await screen.findByRole('checkbox', {
      name: /Send from this mailbox by default/i,
    })
    await waitFor(() => {
      expect(checkbox).not.toBeDisabled()
    })
    expect(checkbox).not.toBeChecked()

    await fireEvent.click(checkbox)
    await waitFor(() => {
      expect(seenPosts.length).toBe(1)
    })
    expect(JSON.parse(seenPosts[0].body)).toEqual({ id: 'work_x' })

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /Send from this mailbox by default/i })).toBeChecked()
    })

    await fireEvent.click(screen.getByRole('checkbox', { name: /Send from this mailbox by default/i }))
    await waitFor(() => {
      expect(seenPosts.length).toBe(2)
    })
    expect(JSON.parse(seenPosts[1].body)).toEqual({ id: '' })
  })

  it('shows Index & sync for Google Drive with detail payload', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(async (url) => {
        const u = String(url)
        if (u.includes('/api/hub/sources/detail')) {
          return new Response(
            JSON.stringify({
              ok: true,
              id: 'gd1',
              kind: 'googleDrive',
              displayName: 'you@gmail.com',
              path: null,
              email: 'you@gmail.com',
              label: null,
              oauthSourceId: 'mb1',
              fileSource: {
                roots: [],
                includeGlobs: [],
                ignoreGlobs: [],
                maxFileBytes: 10_000_000,
                respectGitignore: true,
              },
              includeSharedWithMe: false,
              calendarIds: null,
              icsUrl: null,
              status: {
                documentIndexRows: 100,
                calendarEventRows: 0,
                lastSyncedAt: '2026-04-30T12:00:00Z',
              },
            }),
            { status: 200 },
          )
        }
        if (u.endsWith('/api/hub/sources') || u.includes('/api/hub/sources?')) {
          return new Response(
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
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )

    render(HubConnectorSourcePanel, { props: { sourceId: 'gd1', onClose: () => {} } })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Index & sync/i })).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument()
    })
    expect(screen.getByText(/Google Drive/i)).toBeInTheDocument()
  })

  it('Refresh index for Google Drive does not re-fetch the sources list (avoids panel flicker)', async () => {
    let sourcesListGets = 0
    const detailPayload = {
      ok: true,
      id: 'gd1',
      kind: 'googleDrive',
      displayName: 'you@gmail.com',
      path: null,
      email: 'you@gmail.com',
      label: null,
      oauthSourceId: 'mb1',
      fileSource: {
        roots: [{ id: 'folder1', name: 'Docs', recursive: true }],
        includeGlobs: [] as string[],
        ignoreGlobs: [] as string[],
        maxFileBytes: 10_000_000,
        respectGitignore: true,
      },
      includeSharedWithMe: false,
      calendarIds: null,
      icsUrl: null,
      status: {
        documentIndexRows: 60,
        calendarEventRows: 0,
        lastSyncedAt: null as string | null,
      },
    }
    vi.stubGlobal(
      'fetch',
      makeFetch(async (url, init) => {
        const u = String(url)
        const method = init?.method ?? 'GET'
        if (
          (u.endsWith('/api/hub/sources') || u.includes('/api/hub/sources?')) &&
          method === 'GET'
        ) {
          sourcesListGets += 1
          return new Response(
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
          )
        }
        if (u.includes('/api/hub/sources/detail')) {
          return new Response(JSON.stringify(detailPayload), { status: 200 })
        }
        if (method === 'POST' && u.includes('/api/hub/sources/refresh')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        return new Response('not found', { status: 404 })
      }),
    )

    render(HubConnectorSourcePanel, { props: { sourceId: 'gd1', onClose: () => {} } })

    await waitFor(() => {
      expect(screen.getByText('60')).toBeInTheDocument()
    })
    expect(sourcesListGets).toBe(1)

    await fireEvent.click(screen.getByRole('button', { name: /Refresh index/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Syncing/i })).toBeInTheDocument()
    })

    expect(sourcesListGets).toBe(1)
  })

  it('disables Refresh index for Google Drive when fileSource has no roots', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(async (url) => {
        const u = String(url)
        if (u.includes('/api/hub/sources/detail')) {
          return new Response(
            JSON.stringify({
              ok: true,
              id: 'gd1',
              kind: 'googleDrive',
              displayName: 'you@gmail.com',
              path: null,
              email: 'you@gmail.com',
              label: null,
              oauthSourceId: 'mb1',
              fileSource: { roots: [], includeGlobs: [], ignoreGlobs: [], maxFileBytes: 1e7, respectGitignore: true },
              includeSharedWithMe: false,
              calendarIds: null,
              icsUrl: null,
              status: { documentIndexRows: 0, calendarEventRows: 0, lastSyncedAt: null },
            }),
            { status: 200 },
          )
        }
        if (u.endsWith('/api/hub/sources') || u.includes('/api/hub/sources?')) {
          return new Response(
            JSON.stringify({
              sources: [{ id: 'gd1', kind: 'googleDrive', displayName: 'you@gmail.com', path: null }],
            }),
            { status: 200 },
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )

    render(HubConnectorSourcePanel, { props: { sourceId: 'gd1', onClose: () => {} } })

    const refresh = await screen.findByRole('button', { name: /Refresh index/i })
    await waitFor(() => {
      expect(refresh).toBeDisabled()
    })
    expect(refresh.getAttribute('title') ?? '').toMatch(/folder/i)
  })
})
