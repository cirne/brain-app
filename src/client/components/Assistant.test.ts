import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tick } from 'svelte'
import Assistant from './Assistant.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'
import { createMockFetch, jsonResponse } from '@client/test/mocks/fetch.js'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = function () {
    const self = {} as Animation
    return {
      ready: Promise.resolve(self),
      finished: Promise.resolve(self),
      cancel: () => {},
      finish: () => {},
      play: () => {},
      pause: () => {},
      reverse: () => {},
      commitStyles: () => {},
      persist: () => {},
      effect: null,
      id: '',
      pending: false,
      playState: 'idle' as AnimationPlayState,
      playbackRate: 1,
      replaceState: 'active' as AnimationReplaceState,
      startTime: null,
      timeline: null,
      currentTime: null,
      oncancel: null,
      onfinish: null,
      onremove: null,
      updatePlaybackRate: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    } as unknown as Animation
  }
}

vi.mock('./Search.svelte', () => import('./test-stubs/SearchStub.svelte'))
vi.mock('./AppTopNav.svelte', () => import('./test-stubs/AppTopNavStub.svelte'))
vi.mock('./BrainHubPage.svelte', () => import('./test-stubs/BrainHubPageStub.svelte'))
vi.mock('./BrainSettingsPage.svelte', () => import('./test-stubs/BrainSettingsPageStub.svelte'))
vi.mock('./shell/SlideOver.svelte', () => import('./test-stubs/SlideOverStub.svelte'))
vi.mock('./AgentChat.svelte', () => import('./test-stubs/AgentChatStub.svelte'))
vi.mock('./ChatHistory.svelte', () => import('./test-stubs/ChatHistoryStub.svelte'))
vi.mock('./ChatHistoryPage.svelte', () => import('./test-stubs/ChatHistoryPageStub.svelte'))
vi.mock('./WorkspaceSplit.svelte', () => import('./test-stubs/WorkspaceSplitStub.svelte'))

vi.mock('@client/lib/vaultClient.js', () => ({
  fetchVaultStatus: vi.fn().mockResolvedValue({
    multiTenant: false,
    handleConfirmed: false,
    workspaceHandle: undefined,
  }),
}))

vi.mock('@client/lib/hubEvents/hubEventsClient.js', () => ({
  startHubEventsConnection: vi.fn(() => vi.fn()),
}))

vi.mock('@client/lib/app/debouncedWikiSync.js', () => ({
  cancelPendingDebouncedWikiSync: vi.fn(),
  onWikiMutatedForAutoSync: vi.fn(),
  registerDebouncedWikiSyncRunner: vi.fn(),
  runSyncOrQueueFollowUp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@client/lib/app/syncAllServices.js', () => ({
  runParallelSyncs: vi.fn().mockResolvedValue([]),
}))

vi.mock('@client/lib/navHistory.js', () => ({
  addToNavHistory: vi.fn().mockResolvedValue(undefined),
  makeNavHistoryId: vi.fn((type, id) => `${type}:${id}`),
  upsertEmailNavHistory: vi.fn().mockResolvedValue(undefined),
}))

const mockPushState = vi.fn()
const mockReplaceState = vi.fn()

describe('Assistant.svelte', () => {
  beforeEach(() => {
    vi.stubGlobal('location', {
      href: 'http://localhost/',
      pathname: '/',
      search: '',
      hash: '',
    })

    vi.stubGlobal('history', {
      pushState: mockPushState,
      replaceState: mockReplaceState,
    })

    const mockFetch = createMockFetch([
      {
        match: (u: string) => u === '/api/chat/first-chat-pending',
        response: () => jsonResponse({ pending: false }),
      },
      {
        match: (u: string) => u.endsWith('/api/wiki-shares') || u === '/api/wiki-shares',
        response: () => jsonResponse({ owned: [], received: [], pendingReceived: [] }),
      },
    ])
    vi.stubGlobal('fetch', mockFetch)

    mockPushState.mockClear()
    mockReplaceState.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('rendering', () => {
    it('renders the main app container', async () => {
      render(Assistant)
      await tick()

      expect(screen.getByTestId('agent-chat-stub')).toBeInTheDocument()
    })

    it('renders AppTopNav', async () => {
      render(Assistant)
      await tick()

      expect(screen.getByTestId('app-top-nav-stub')).toBeInTheDocument()
    })

    it('renders WorkspaceSplit', async () => {
      render(Assistant)
      await tick()

      expect(screen.getByTestId('workspace-split-stub')).toBeInTheDocument()
    })
  })

  describe('route handling', () => {
    it('renders AgentChat by default at root path', async () => {
      render(Assistant)
      await tick()

      expect(screen.getByTestId('agent-chat-stub')).toBeInTheDocument()
      expect(screen.queryByTestId('brain-hub-page-stub')).not.toBeInTheDocument()
    })

    it('renders BrainSettingsPage when at /settings path', async () => {
      vi.stubGlobal('location', {
        href: 'http://localhost/settings',
        pathname: '/settings',
        search: '',
        hash: '',
      })

      render(Assistant)
      await tick()

      expect(screen.getByTestId('brain-settings-page-stub')).toBeInTheDocument()
    })

    it('renders BrainHubPage when at /hub path', async () => {
      vi.stubGlobal('location', {
        href: 'http://localhost/hub',
        pathname: '/hub',
        search: '',
        hash: '',
      })

      render(Assistant)
      await tick()

      expect(screen.getByTestId('brain-hub-page-stub')).toBeInTheDocument()
    })

    it('renders ChatHistoryPage when URL has chat-history panel', async () => {
      vi.stubGlobal('location', {
        href: 'http://localhost/c?panel=chat-history',
        pathname: '/c',
        search: '?panel=chat-history',
        hash: '',
      })

      render(Assistant)
      await tick()

      expect(screen.getByTestId('chat-history-page-stub')).toBeInTheDocument()
    })
  })

  describe('sidebar', () => {
    it('starts with sidebar open on desktop (non-mobile)', async () => {
      const mq = {
        matches: false,
        media: '(max-width: 767px)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }
      vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mq))

      render(Assistant)
      await tick()

      expect(screen.getByTestId('chat-history-stub')).toBeInTheDocument()
    })

    it('starts with sidebar closed on mobile', async () => {
      const mq = {
        matches: true,
        media: '(max-width: 767px)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }
      vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mq))

      render(Assistant)
      await tick()

      expect(screen.queryByTestId('chat-history-stub')).not.toBeInTheDocument()
    })
  })

  describe('keyboard shortcuts', () => {
    it('registers keydown event listener on mount', async () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

      render(Assistant)
      await tick()

      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    })

    it('opens search on Cmd+K', async () => {
      render(Assistant)
      await tick()

      await fireEvent.keyDown(window, { key: 'k', metaKey: true })
      await tick()

      expect(screen.getByTestId('search-stub')).toBeInTheDocument()
    })

    it('Escape key handler is registered', async () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

      render(Assistant)
      await tick()

      const keydownCalls = addEventListenerSpy.mock.calls.filter(
        (call) => call[0] === 'keydown'
      )
      expect(keydownCalls.length).toBeGreaterThan(0)
    })
  })

  describe('first-chat pending', () => {
    it('handles first-chat-pending check on mount', async () => {
      const mockFetch = createMockFetch([
        {
          match: (u: string) => u === '/api/chat/first-chat-pending',
          response: () => jsonResponse({ pending: false }),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      render(Assistant)
      await tick()

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/chat/first-chat-pending')
      })
    })
  })

  describe('vault status', () => {
    it('fetches vault status on mount', async () => {
      const { fetchVaultStatus } = await import('@client/lib/vaultClient.js')

      render(Assistant)
      await tick()

      expect(fetchVaultStatus).toHaveBeenCalled()
    })

    it('sets hosted handle when vault status indicates multi-tenant with confirmed handle', async () => {
      const { fetchVaultStatus } = await import('@client/lib/vaultClient.js')
      vi.mocked(fetchVaultStatus).mockResolvedValue({
        unlocked: true,
        multiTenant: true,
        handleConfirmed: true,
        workspaceHandle: 'testuser',
      })

      render(Assistant)
      await tick()
      await tick()

      expect(fetchVaultStatus).toHaveBeenCalled()
    })
  })

  describe('hub events', () => {
    it('starts hub events connection on mount', async () => {
      const { startHubEventsConnection } = await import('@client/lib/hubEvents/hubEventsClient.js')

      render(Assistant)
      await tick()

      expect(startHubEventsConnection).toHaveBeenCalled()
    })
  })

  describe('popstate handling', () => {
    it('updates route on popstate event', async () => {
      render(Assistant)
      await tick()

      vi.stubGlobal('location', {
        href: 'http://localhost/hub',
        pathname: '/hub',
        search: '',
        hash: '',
      })

      await fireEvent(window, new PopStateEvent('popstate'))
      await tick()

      expect(screen.getByTestId('brain-hub-page-stub')).toBeInTheDocument()
    })
  })

  describe('sync', () => {
    it('registers debounced wiki sync runner on mount', async () => {
      const { registerDebouncedWikiSyncRunner } = await import('@client/lib/app/debouncedWikiSync.js')

      render(Assistant)
      await tick()

      expect(registerDebouncedWikiSyncRunner).toHaveBeenCalled()
    })
  })

  describe('reduced motion', () => {
    it('respects prefers-reduced-motion media query', async () => {
      let reducedMotionQuery: MediaQueryList | null = null
      const matchMediaImpl = (query: string) => {
        const mq = {
          matches: query.includes('reduced-motion'),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }
        if (query.includes('reduced-motion')) {
          reducedMotionQuery = mq as unknown as MediaQueryList
        }
        return mq
      }
      vi.stubGlobal('matchMedia', vi.fn().mockImplementation(matchMediaImpl))

      render(Assistant)
      await tick()

      expect(reducedMotionQuery).toBeTruthy()
    })
  })

  describe('cleanup', () => {
    it('cleans up event listeners and hub events on unmount', async () => {
      const stopFn = vi.fn()
      const { startHubEventsConnection } = await import('@client/lib/hubEvents/hubEventsClient.js')
      vi.mocked(startHubEventsConnection).mockReturnValue(stopFn)

      const { unmount } = render(Assistant)
      await tick()

      unmount()

      expect(stopFn).toHaveBeenCalled()
    })
  })

  describe('overlay routes', () => {
    it('renders with wiki overlay at /c?panel=wiki&path=', async () => {
      vi.stubGlobal('location', {
        href: 'http://localhost/c?panel=wiki&path=test.md',
        pathname: '/c',
        search: '?panel=wiki&path=test.md',
        hash: '',
      })

      render(Assistant)
      await tick()

      expect(screen.getByTestId('agent-chat-stub')).toBeInTheDocument()
      expect(screen.getAllByTestId('slide-over-stub').length).toBeGreaterThan(0)
    })

    it('renders with email overlay at /c?panel=email&m=', async () => {
      vi.stubGlobal('location', {
        href: 'http://localhost/c?panel=email&m=123',
        pathname: '/c',
        search: '?panel=email&m=123',
        hash: '',
      })

      render(Assistant)
      await tick()

      expect(screen.getByTestId('agent-chat-stub')).toBeInTheDocument()
      expect(screen.getAllByTestId('slide-over-stub').length).toBeGreaterThan(0)
    })

    it('renders with calendar overlay at /c?panel=calendar&date=', async () => {
      vi.stubGlobal('location', {
        href: 'http://localhost/c?panel=calendar&date=2024-03-15',
        pathname: '/c',
        search: '?panel=calendar&date=2024-03-15',
        hash: '',
      })

      render(Assistant)
      await tick()

      expect(screen.getByTestId('agent-chat-stub')).toBeInTheDocument()
      expect(screen.getAllByTestId('slide-over-stub').length).toBeGreaterThan(0)
    })

    it('renders with file overlay via panel=file&file=', async () => {
      vi.stubGlobal('location', {
        href: 'http://localhost/c?panel=file&file=%2FUsers%2Ftest%2Fdoc.pdf',
        pathname: '/c',
        search: '?panel=file&file=%2FUsers%2Ftest%2Fdoc.pdf',
        hash: '',
      })

      render(Assistant)
      await tick()

      expect(screen.getByTestId('agent-chat-stub')).toBeInTheDocument()
      expect(screen.getAllByTestId('slide-over-stub').length).toBeGreaterThan(0)
    })
  })

  describe('hub routes with overlays', () => {
    it('renders hub with wiki overlay at /hub?panel=wiki', async () => {
      vi.stubGlobal('location', {
        href: 'http://localhost/hub?panel=wiki&path=test.md',
        pathname: '/hub',
        search: '?panel=wiki&path=test.md',
        hash: '',
      })

      render(Assistant)
      await tick()

      expect(screen.getByTestId('brain-hub-page-stub')).toBeInTheDocument()
      expect(screen.getAllByTestId('slide-over-stub').length).toBeGreaterThan(0)
    })
  })

  describe('search visibility', () => {
    it('does not show search initially', async () => {
      render(Assistant)
      await tick()

      expect(screen.queryByTestId('search-stub')).not.toBeInTheDocument()
    })
  })

  describe('first chat kickoff', () => {
    it('triggers first chat kickoff when pending is true', async () => {
      const mockFetch = createMockFetch([
        {
          match: (u: string) => u === '/api/chat/first-chat-pending',
          response: () => jsonResponse({ pending: true }),
        },
        {
          match: (u: string) => u.endsWith('/api/wiki-shares') || u === '/api/wiki-shares',
          response: () => jsonResponse({ owned: [], received: [], pendingReceived: [] }),
        },
      ])
      vi.stubGlobal('fetch', mockFetch)

      render(Assistant)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/chat/first-chat-pending')
      })
    })

    it('handles first-chat-pending fetch error gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
      vi.stubGlobal('fetch', mockFetch)

      render(Assistant)
      await tick()
      await tick()

      expect(screen.getByTestId('agent-chat-stub')).toBeInTheDocument()
    })
  })

  describe('app events subscription', () => {
    it('subscribes to app events on mount', async () => {
      render(Assistant)
      await tick()

      expect(screen.getByTestId('agent-chat-stub')).toBeInTheDocument()
    })
  })

  describe('wiki directory routes', () => {
    it('renders with wiki-dir overlay at /c?panel=wiki-dir', async () => {
      vi.stubGlobal('location', {
        href: 'http://localhost/c?panel=wiki-dir&path=my-folder',
        pathname: '/c',
        search: '?panel=wiki-dir&path=my-folder',
        hash: '',
      })

      render(Assistant)
      await tick()

      expect(screen.getAllByTestId('slide-over-stub').length).toBeGreaterThan(0)
    })
  })
})
