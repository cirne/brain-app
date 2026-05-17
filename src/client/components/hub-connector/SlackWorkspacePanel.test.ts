import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@client/test/render.js'
import SlackWorkspacePanel from './SlackWorkspacePanel.svelte'
import {
  HUB_SOURCE_SLIDE_HEADER,
  type HubSourceSlideHeaderCell,
  type HubSourceSlideHeaderState,
} from '@client/lib/hubSourceSlideHeaderContext.js'
import { makeSlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'
import { emit } from '@client/lib/app/appEvents.js'

vi.mock('@client/lib/app/appEvents.js', () => ({
  emit: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}))

const BUILTIN_BODIES = {
  trusted: 'Trusted body',
  general: 'General body',
  'minimal-disclosure': 'Minimal body',
  'server-default': 'Default body',
}

describe('SlackWorkspacePanel.svelte', () => {
  beforeEach(() => {
    vi.mocked(emit).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function slackFetch(autorespond = false, inboundPolicy = 'general'): typeof fetch {
    let lastAutorespond = autorespond
    let lastInboundPolicy = inboundPolicy
    return vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (u.includes('/api/brain-query/builtin-policy-bodies')) {
        return Promise.resolve(
          new Response(JSON.stringify({ bodies: BUILTIN_BODIES }), { status: 200 }),
        )
      }
      if (u.includes('/api/brain-query/policies')) {
        return Promise.resolve(new Response(JSON.stringify({ policies: [] }), { status: 200 }))
      }
      if (u.includes('/api/slack/connection') && !u.includes('/settings')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              oauthConfigured: true,
              workspaces: [
                {
                  slackTeamId: 'T001',
                  teamName: 'Gamaliel',
                  workspaceConnected: true,
                  userLinked: true,
                  slackUserId: 'U1',
                },
              ],
            }),
            { status: 200 },
          ),
        )
      }
      if (u.includes('/api/slack/connection/T001/settings')) {
        if ((init?.method ?? 'GET').toUpperCase() === 'PATCH') {
          try {
            const b = typeof init!.body === 'string' ? JSON.parse(init!.body!) : {}
            if (typeof b.autorespond === 'boolean') lastAutorespond = b.autorespond
            if (typeof b.inboundPolicy === 'string') lastInboundPolicy = b.inboundPolicy
          } catch {
            /* ignore */
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                autorespond: lastAutorespond,
                inboundPolicy: lastInboundPolicy,
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              autorespond: lastAutorespond,
              inboundPolicy: lastInboundPolicy,
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    }) as unknown as typeof fetch
  }

  it('shows workspace title from connection list and unchecked autorespond by default', async () => {
    vi.stubGlobal('fetch', slackFetch(false))

    const cell: HubSourceSlideHeaderCell = makeSlideHeaderCell<HubSourceSlideHeaderState>()
    const context = new Map<symbol, HubSourceSlideHeaderCell>([[HUB_SOURCE_SLIDE_HEADER, cell]])
    render(SlackWorkspacePanel, {
      props: { teamId: 'T001', onClose: vi.fn() },
      context,
    } as unknown as Parameters<typeof render>[1])

    await waitFor(() => {
      expect(cell.current?.title).toBe('Gamaliel')
    })
    expect(screen.getByTestId('slack-reply-review')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('slack-reply-auto')).toHaveAttribute('aria-checked', 'false')
    await waitFor(() => {
      expect(screen.getByText(/trusted confidante/i)).toBeInTheDocument()
      expect(screen.getByText(/minimal disclosure/i)).toBeInTheDocument()
    })
  })

  it('shows confirm dialog before enabling autorespond', async () => {
    const mockFetch = slackFetch(false)
    vi.stubGlobal('fetch', mockFetch)

    render(SlackWorkspacePanel, { props: { teamId: 'T001', onClose: vi.fn() } })

    await waitFor(() => {
      const auto = screen.getByTestId('slack-reply-auto')
      expect(auto).toHaveAttribute('aria-disabled', 'false')
    })
    await fireEvent.click(screen.getByTestId('slack-reply-auto'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/autosend replies in slack/i)).toBeInTheDocument()
    expect(screen.getByTestId('slack-reply-review')).toHaveAttribute('aria-checked', 'true')

    await fireEvent.click(within(dialog).getByRole('button', { name: /^autosend$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('slack-reply-auto')).toHaveAttribute('aria-checked', 'true')
    })
    const patchBody = JSON.parse(
      vi
        .mocked(mockFetch)
        .mock.calls.find(
          ([u, init]) =>
            typeof u === 'string' &&
            u.includes('/settings') &&
            (init as RequestInit)?.method === 'PATCH',
        )?.[1]!.body as string,
    )
    expect(patchBody.autorespond).toBe(true)
  })

  it('sends PATCH when inbound policy is changed', async () => {
    const mockFetch = slackFetch(false, 'general')
    vi.stubGlobal('fetch', mockFetch)

    render(SlackWorkspacePanel, { props: { teamId: 'T001', onClose: vi.fn() } })

    await waitFor(() => screen.getByText(/trusted confidante/i))
    const trusted = screen.getByRole('radio', { name: /trusted confidante/i })
    await fireEvent.click(trusted)

    await waitFor(() => {
      const patchBody = JSON.parse(
        vi
          .mocked(mockFetch)
          .mock.calls.find(
            ([u, init]) =>
              typeof u === 'string' &&
              u.includes('/settings') &&
              (init as RequestInit)?.method === 'PATCH',
          )?.[1]!.body as string,
      )
      expect(patchBody.inboundPolicy).toBe('trusted')
    })
  })

  it('shows alert when PATCH fails', async () => {
    const mockFetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (u.includes('/api/brain-query/builtin-policy-bodies')) {
        return Promise.resolve(
          new Response(JSON.stringify({ bodies: BUILTIN_BODIES }), { status: 200 }),
        )
      }
      if (u.includes('/api/brain-query/policies')) {
        return Promise.resolve(new Response(JSON.stringify({ policies: [] }), { status: 200 }))
      }
      if (u.includes('/api/slack/connection') && !u.includes('/settings')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, oauthConfigured: true, workspaces: [] }), {
            status: 200,
          }),
        )
      }
      if (u.includes('/settings') && init?.method === 'PATCH') {
        return Promise.resolve(new Response('bad', { status: 400 }))
      }
      if (u.includes('/settings')) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, autorespond: false, inboundPolicy: 'general' }), {
            status: 200,
          }),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    }) as typeof fetch
    vi.stubGlobal('fetch', mockFetch)

    render(SlackWorkspacePanel, { props: { teamId: 'T001', onClose: vi.fn() } })
    await waitFor(() => {
      const auto = screen.getByTestId('slack-reply-auto')
      expect(auto).toHaveAttribute('aria-disabled', 'false')
    })
    await fireEvent.click(screen.getByTestId('slack-reply-auto'))
    const dialog = await screen.findByRole('dialog')
    await fireEvent.click(within(dialog).getByRole('button', { name: /^autosend$/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not save settings/i)
    })
  })

  it('disconnect emits slack:connections-changed and calls onClose', async () => {
    const onClose = vi.fn()
    const mockFetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (init?.method === 'DELETE' && u.includes('/api/slack/link')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      }
      if (u.includes('/api/brain-query/builtin-policy-bodies')) {
        return Promise.resolve(
          new Response(JSON.stringify({ bodies: BUILTIN_BODIES }), { status: 200 }),
        )
      }
      if (u.includes('/api/brain-query/policies')) {
        return Promise.resolve(new Response(JSON.stringify({ policies: [] }), { status: 200 }))
      }
      if (u.includes('/api/slack/connection') && !u.includes('/settings')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              oauthConfigured: true,
              workspaces: [{ slackTeamId: 'T001', teamName: 'Gamaliel', workspaceConnected: true, userLinked: true, slackUserId: 'U1' }],
            }),
            { status: 200 },
          ),
        )
      }
      if (u.includes('/settings')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, autorespond: false, inboundPolicy: 'general' }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    }) as typeof fetch

    vi.stubGlobal('fetch', mockFetch)

    render(SlackWorkspacePanel, { props: { teamId: 'T001', onClose } })
    await waitFor(() => screen.getByRole('button', { name: /^disconnect$/i }))

    await fireEvent.click(screen.getByRole('button', { name: /^disconnect$/i }))

    await waitFor(() => {
      const delCalls = mockFetch.mock.calls.filter(
        ([_, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      )
      expect(delCalls.length).toBeGreaterThanOrEqual(1)
      expect(emit).toHaveBeenCalledWith({ type: 'slack:connections-changed' })
      expect(onClose).toHaveBeenCalled()
    })
  })
})
