import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@client/test/render.js'
import BrainSettingsPage from './BrainSettingsPage.svelte'

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

vi.mock('@client/lib/hubEvents/hubEventsClient.js', () => ({
  startHubEventsConnection: () => () => {},
}))

function defaultFetchHandler(): typeof fetch {
  return vi.fn((url: RequestInfo | URL) => {
    const u = requestUrlString(url)
    if (u.includes('/api/onboarding/status')) {
      return Promise.resolve(new Response(JSON.stringify({ state: 'done' }), { status: 200 }))
    }
    if (u.includes('/api/wiki') && !u.includes('edit-history')) {
      return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }))
    }
    if (u.includes('/api/background-status')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
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
              detail: '',
              lastRunAt: null,
              autoStartEligible: false,
              bootstrap: { status: 'not-started', completedAt: null },
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
          }),
          { status: 200 },
        ),
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
      props: { onSettingsNavigate: vi.fn(), brainQueryEnabled: true },
    })
    expect(screen.getByRole('heading', { level: 1, name: /settings/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('@testuser')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument()
    })
  })

  it('shows banner and strips add-account query on /settings', async () => {
    window.history.replaceState(null, '', '/settings?addedAccount=second%40example.com')
    render(BrainSettingsPage, {
      props: { onSettingsNavigate: vi.fn(), brainQueryEnabled: true },
    })
    await waitFor(() => {
      expect(screen.getByText(/Added second@example\.com/i)).toBeInTheDocument()
    })
    expect(window.location.search).toBe('')
  })

  it('Brain to Brain access row opens brain-access overlay', async () => {
    const onSettingsNavigate = vi.fn()
    render(BrainSettingsPage, {
      props: { onSettingsNavigate, brainQueryEnabled: true },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /brain to brain access/i })).toBeInTheDocument()
    })
    await fireEvent.click(screen.getByRole('button', { name: /brain to brain access/i }))
    expect(onSettingsNavigate).toHaveBeenCalledWith({ type: 'brain-access' })
  })

  it('hides Brain to Brain access when brainQueryEnabled is false', async () => {
    render(BrainSettingsPage, {
      props: { onSettingsNavigate: vi.fn(), brainQueryEnabled: false },
    })
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /settings/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /brain to brain access/i })).not.toBeInTheDocument()
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
      props: { onSettingsNavigate: vi.fn(), brainQueryEnabled: true },
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

})
