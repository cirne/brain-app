import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@client/test/render.js'
import { fetchVaultStatus } from '@client/lib/vaultClient.js'
import type { BackgroundAgentDoc } from '@client/lib/statusBar/backgroundAgentTypes.js'
import BrainHubPage from './BrainHubPage.svelte'
import type { BackgroundStatusResponse } from '@shared/backgroundStatus.js'

function mockBackgroundStatus(overrides: Partial<BackgroundStatusResponse> = {}): BackgroundStatusResponse {
  const base: BackgroundStatusResponse = {
    updatedAt: '2026-01-01T00:00:00.000Z',
    onboardingFlowActive: false,
    mail: {
      indexedTotal: 0,
      ftsReady: 0,
      messageAvailableForProgress: null,
      configured: false,
      dateRange: { from: null, to: null },
      phase1Complete: false,
      phase2Complete: false,
      syncRunning: false,
      backfillRunning: false,
      backfillPhase: null,
      refreshRunning: false,
      lastSyncedAt: null,
      syncLockAgeMs: null,
      pendingBackfill: false,
      staleMailSyncLock: false,
    },
    wiki: {
      status: 'idle',
      phase: 'idle',
      pageCount: 0,
      currentLap: 0,
      detail: 'Not yet started',
      lastRunAt: null,
      autoStartEligible: false,
      bootstrap: {
        status: 'completed',
        completedAt: '2026-01-01T00:00:00.000Z',
        stats: { peopleCreated: 0, projectsCreated: 0, topicsCreated: 0, travelCreated: 0 },
      },
    },
    onboarding: {
      state: 'done',
      wikiMeExists: false,
      milestones: {
        interviewReady: false,
        wikiReady: false,
        fullySynced: false,
      },
    },
  }
  return {
    ...base,
    ...overrides,
    mail: { ...base.mail, ...overrides.mail },
    wiki: { ...base.wiki, ...overrides.wiki },
    onboarding: { ...base.onboarding, ...overrides.onboarding },
  }
}

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

/** Minimal EventSource so Hub can open `/api/events`. */
class StubEventSource {
  url: string
  constructor(url: string) {
    this.url = url
  }

  close(): void {}

  addEventListener(): void {}
}

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
    if (u.includes('/api/background-status')) {
      return Promise.resolve(
        new Response(JSON.stringify(mockBackgroundStatus()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
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
    vi.stubGlobal('EventSource', StubEventSource)
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

  it('polls /api/background-status while Hub stays mounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const fetchMock = vi.fn(defaultFetchHandler())
      vi.stubGlobal('fetch', fetchMock)

      render(BrainHubPage, { props: { onHubNavigate: vi.fn() } })

      await waitFor(() => {
        const n = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/background-status')).length
        expect(n).toBeGreaterThanOrEqual(1)
      })

      const countBefore = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/background-status')).length

      await vi.advanceTimersByTimeAsync(4000)

      await waitFor(() => {
        const n = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/background-status')).length
        expect(n).toBeGreaterThan(countBefore)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows connected sources summary in overview when sources exist', async () => {
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
        if (u.includes('/api/background-status')) {
          return Promise.resolve(
            new Response(
              JSON.stringify(
                mockBackgroundStatus({
                  mail: {
                    indexedTotal: 2,
                    ftsReady: 2,
                    messageAvailableForProgress: 2,
                    configured: true,
                    dateRange: { from: null, to: null },
                    phase1Complete: true,
                    phase2Complete: true,
                    syncRunning: false,
                    backfillRunning: false,
                    backfillPhase: null,
                    refreshRunning: false,
                    lastSyncedAt: null,
                    syncLockAgeMs: null,
                    pendingBackfill: false,
                    staleMailSyncLock: false,
                  },
                }),
              ),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
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
      expect(screen.getByRole('heading', { level: 2, name: /what.*running/i })).toBeInTheDocument()
      expect(screen.getByText(/Connected sources/i)).toBeInTheDocument()
      expect(screen.getByText(/1 mailbox/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Add another Gmail account/i })).not.toBeInTheDocument()
  })

  it('Manage in Settings invokes onOpenSettings when wired', async () => {
    const onOpenSettings = vi.fn()
    render(BrainHubPage, { props: { onHubNavigate: vi.fn(), onOpenSettings } })

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /what.*running/i })).toBeInTheDocument()
    })

    await fireEvent.click(screen.getByRole('button', { name: /manage in settings/i }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('disables Sync mail now while background mail sync is running', async () => {
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
        if (u.includes('/api/background-status')) {
          return Promise.resolve(
            new Response(
              JSON.stringify(
                mockBackgroundStatus({
                  mail: {
                    indexedTotal: 10,
                    ftsReady: 10,
                    messageAvailableForProgress: 10,
                    configured: true,
                    dateRange: { from: null, to: null },
                    phase1Complete: true,
                    phase2Complete: true,
                    syncRunning: true,
                    backfillRunning: false,
                    backfillPhase: null,
                    refreshRunning: false,
                    lastSyncedAt: '2026-01-01T00:00:00.000Z',
                    syncLockAgeMs: null,
                    pendingBackfill: false,
                    staleMailSyncLock: false,
                  },
                }),
              ),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        if (u.includes('/api/hub/sources/detail')) {
          return Promise.resolve(
            new Response(JSON.stringify({ ok: false, error: 'not used' }), { status: 200 }),
          )
        }
        if (u.includes('/api/hub/sources')) {
          return Promise.resolve(new Response(JSON.stringify({ sources: [] }), { status: 200 }))
        }
        return Promise.resolve(new Response('not found', { status: 404 }))
      }) as unknown as typeof fetch,
    )

    render(BrainHubPage, { props: { onHubNavigate: vi.fn() } })

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /sync mail now/i })
      expect(btn).toBeDisabled()
      expect(btn).toHaveAttribute('aria-busy', 'true')
    })
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
