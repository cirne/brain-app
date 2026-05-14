import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@client/test/render.js'
import HubConnectorSourcePanel from './HubConnectorSourcePanel.svelte'
import {
  HUB_SOURCE_SLIDE_HEADER,
  type HubSourceSlideHeaderCell,
  type HubSourceSlideHeaderState,
} from '@client/lib/hubSourceSlideHeaderContext.js'
import { makeSlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'

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
            backfillListedTarget: null,
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

  it('claims the hub-source slide header cell with a stable refresh handler', async () => {
    const prefsState = {
      defaultSendSource: null as string | null,
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

    const cell: HubSourceSlideHeaderCell = makeSlideHeaderCell<HubSourceSlideHeaderState>()
    const context = new Map<symbol, HubSourceSlideHeaderCell>([[HUB_SOURCE_SLIDE_HEADER, cell]])

    render(HubConnectorSourcePanel, {
      props: { sourceId: 'work_x', onClose: () => {} },
      context,
    } as unknown as Parameters<typeof render>[1])

    await waitFor(() => {
      expect(cell.claimed).toBe(true)
    })

    expect(cell.current?.title).toBe('work@example.com')
    expect(typeof cell.current?.onRefresh).toBe('function')
    const refreshRef = cell.current?.onRefresh

    // After background polling fires (mail-status), the cell should still hold the same
    // refresh handler — patches must not rebuild handler refs.
    await new Promise((r) => setTimeout(r, 30))
    expect(cell.current?.onRefresh).toBe(refreshRef)
  })

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

  it('shows index stats for Google Drive with detail payload', async () => {
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
      expect(screen.getByText(/100 documents/)).toBeInTheDocument()
    })
    expect(screen.getAllByText(/Google Drive/i).length).toBeGreaterThan(0)
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
      expect(screen.getByText(/60 documents/)).toBeInTheDocument()
    })
    expect(sourcesListGets).toBe(1)

    await fireEvent.click(screen.getByRole('button', { name: /Refresh index/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Syncing/i })).toBeInTheDocument()
    })

    expect(sourcesListGets).toBe(1)
  })

  it('allows Refresh index for Google Drive when fileSource has no roots', async () => {
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
      expect(refresh).not.toBeDisabled()
    })
  })

  it('after saving Google Calendar picker, keeps detail mounted while detail reload is in flight', async () => {
    let detailHits = 0
    let releaseSecondDetail: ((value?: void | PromiseLike<void>) => void) | undefined
    const secondDetailGate = new Promise<void>((resolve) => {
      releaseSecondDetail = resolve
    })

    const calendarDetail = {
      ok: true,
      id: 'gcal1',
      kind: 'googleCalendar',
      displayName: 'you@gmail.com',
      path: null,
      email: 'you@gmail.com',
      label: null,
      oauthSourceId: 'mb1',
      fileSource: null,
      includeSharedWithMe: false,
      calendarIds: ['cal-a'],
      icsUrl: null,
      status: {
        documentIndexRows: 0,
        calendarEventRows: 10,
        lastSyncedAt: '2026-04-30T12:00:00Z',
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
          return new Response(
            JSON.stringify({
              sources: [
                {
                  id: 'gcal1',
                  kind: 'googleCalendar',
                  displayName: 'you@gmail.com',
                  path: null,
                },
              ],
            }),
            { status: 200 },
          )
        }
        if (u.includes('/api/hub/sources/detail')) {
          detailHits += 1
          if (detailHits === 1) {
            return new Response(JSON.stringify(calendarDetail), { status: 200 })
          }
          await secondDetailGate
          return new Response(
            JSON.stringify({
              ...calendarDetail,
              calendarIds: ['cal-a', 'cal-b'],
            }),
            { status: 200 },
          )
        }
        if (u.includes('/api/hub/sources/calendars')) {
          return new Response(
            JSON.stringify({
              ok: true,
              allCalendars: [
                { id: 'cal-a', name: 'Alpha', color: '#111' },
                { id: 'cal-b', name: 'Beta', color: '#222' },
              ],
              configuredIds: ['cal-a'],
            }),
            { status: 200 },
          )
        }
        if (method === 'POST' && u.includes('/api/hub/sources/update-calendar-ids')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 })
        }
        return new Response('not found', { status: 404 })
      }),
    )

    render(HubConnectorSourcePanel, { props: { sourceId: 'gcal1', onClose: () => {} } })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^Calendars$/i })).toBeInTheDocument()
    })
    const betaCheckbox = await screen.findByRole('checkbox', { name: /Beta/i })

    await fireEvent.click(betaCheckbox)

    await waitFor(() => {
      expect(detailHits).toBe(2)
    })

    expect(screen.getByRole('heading', { name: /^Calendars$/i })).toBeInTheDocument()

    releaseSecondDetail?.()
    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeInTheDocument()
    })
  })
})
