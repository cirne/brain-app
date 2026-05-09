import { describe, it, expect, vi, beforeEach } from 'vitest'
import AppTopNav from './AppTopNav.svelte'
import AppTopNavMobileOverflowHarness from './test-stubs/AppTopNavMobileOverflowHarness.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('AppTopNav.svelte', () => {
  const baseProps = {
    onToggleSidebar: vi.fn(),
    syncErrors: [] as string[],
    showSyncErrors: false,
    onOpenSearch: vi.fn(),
    onToggleSyncErrors: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('renders nav element with search on desktop', () => {
      render(AppTopNav, { props: baseProps })

      expect(screen.getByRole('navigation')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    })

    it('hides search/wiki actions in mobile compact nav (⋯ overflow)', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          onWikiHome: vi.fn(),
          onNewChat: vi.fn(),
          isEmptyChat: false,
          isMobile: true,
          mobileOverflow: () => {},
        },
      })
      expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument()
    })

    it('shows Braintunnel brand when sidebar is collapsed', () => {
      render(AppTopNav, { props: baseProps })

      expect(screen.getByText('Braintunnel')).toBeInTheDocument()
    })

    it('orders top actions search, wiki home, new chat, then settings (reading / tab order)', () => {
      const onWikiHome = vi.fn()
      const onOpenSettings = vi.fn()
      render(AppTopNav, {
        props: {
          ...baseProps,
          onNewChat: vi.fn(),
          onWikiHome,
          onOpenSettings,
          isEmptyChat: false,
          isMobile: false,
        },
      })
      const search = screen.getByRole('button', { name: 'Search' })
      const wikiHome = screen.getByRole('button', { name: 'Wiki' })
      const newChat = screen.getByRole('button', { name: 'Chat' })
      const settingsBtn = screen.getByRole('button', { name: 'Settings' })
      const after = globalThis.Node.DOCUMENT_POSITION_FOLLOWING
      expect(search.compareDocumentPosition(wikiHome) & after).toBe(after)
      expect(wikiHome.compareDocumentPosition(newChat) & after).toBe(after)
      expect(newChat.compareDocumentPosition(settingsBtn) & after).toBe(after)
    })

    it('shows Wiki and Chat labels on desktop (not isMobile)', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          onWikiHome: vi.fn(),
          onNewChat: vi.fn(),
          isEmptyChat: false,
          isMobile: false,
        },
      })
      expect(screen.getByText('Wiki')).toBeInTheDocument()
      expect(screen.getByText('Chat')).toBeInTheDocument()
    })

    it('uses icon-only wiki/new actions when isMobile (no visible Wiki/New labels)', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          onWikiHome: vi.fn(),
          onNewChat: vi.fn(),
          isEmptyChat: false,
          isMobile: true,
        },
      })
      expect(screen.getByRole('button', { name: 'Wiki home' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'New conversation' })).toBeInTheDocument()
      expect(document.querySelector('.nav-action-label')).toBeNull()
    })

    it('calls onWikiHome when wiki home button is clicked', async () => {
      const onWikiHome = vi.fn()
      render(AppTopNav, {
        props: { ...baseProps, onWikiHome },
      })
      await fireEvent.click(screen.getByRole('button', { name: 'Wiki' }))
      expect(onWikiHome).toHaveBeenCalledTimes(1)
    })
  })

  describe('sidebar toggle', () => {
    it('shows "Open sidebar" button when sidebar is closed', () => {
      render(AppTopNav, {
        props: { ...baseProps, sidebarOpen: false },
      })

      expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument()
    })

    it('shows "Close sidebar" button when sidebar is open', () => {
      render(AppTopNav, {
        props: { ...baseProps, sidebarOpen: true },
      })

      expect(screen.getByRole('button', { name: 'Close sidebar' })).toBeInTheDocument()
    })

    it('calls onToggleSidebar when open sidebar button is clicked', async () => {
      const onToggleSidebar = vi.fn()
      render(AppTopNav, {
        props: { ...baseProps, sidebarOpen: false, onToggleSidebar },
      })

      await fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }))

      expect(onToggleSidebar).toHaveBeenCalledTimes(1)
    })

    it('calls onToggleSidebar when close sidebar button is clicked', async () => {
      const onToggleSidebar = vi.fn()
      render(AppTopNav, {
        props: { ...baseProps, sidebarOpen: true, onToggleSidebar },
      })

      await fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }))

      expect(onToggleSidebar).toHaveBeenCalledTimes(1)
    })
  })

  describe('showChatHistoryButton', () => {
    it('hides left nav section when showChatHistoryButton is false', () => {
      render(AppTopNav, {
        props: { ...baseProps, showChatHistoryButton: false },
      })

      expect(screen.queryByRole('button', { name: 'Open sidebar' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Close sidebar' })).not.toBeInTheDocument()
    })

    it('shows center brand name when showChatHistoryButton is false', () => {
      render(AppTopNav, {
        props: { ...baseProps, showChatHistoryButton: false },
      })

      const brandName = screen.getByText('Braintunnel')
      expect(brandName).toHaveClass('brand-name')
    })
  })

  describe('search button', () => {
    it('calls onOpenSearch when search button is clicked', async () => {
      const onOpenSearch = vi.fn()
      render(AppTopNav, {
        props: { ...baseProps, onOpenSearch },
      })

      await fireEvent.click(screen.getByRole('button', { name: 'Search' }))

      expect(onOpenSearch).toHaveBeenCalledTimes(1)
    })
  })

  describe('new chat button', () => {
    it('shows new chat button when onNewChat is provided', () => {
      render(AppTopNav, {
        props: { ...baseProps, onNewChat: vi.fn(), isEmptyChat: false },
      })

      expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument()
    })

    it('keeps new chat button visible but disabled when isEmptyChat', () => {
      render(AppTopNav, {
        props: { ...baseProps, onNewChat: vi.fn(), isEmptyChat: true },
      })

      const btn = screen.getByRole('button', { name: /New conversation \(already empty\)/ })
      expect(btn).toBeDisabled()
    })

    it('hides new chat button when onNewChat is not provided', () => {
      render(AppTopNav, {
        props: { ...baseProps, isEmptyChat: false },
      })

      expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument()
    })

    it('calls onNewChat when new chat button is clicked', async () => {
      const onNewChat = vi.fn()
      render(AppTopNav, {
        props: { ...baseProps, onNewChat, isEmptyChat: false },
      })

      await fireEvent.click(screen.getByRole('button', { name: 'Chat' }))

      expect(onNewChat).toHaveBeenCalledTimes(1)
    })
  })

  describe('sync errors', () => {
    it('shows sync error badge when syncErrors has items', () => {
      render(AppTopNav, {
        props: { ...baseProps, syncErrors: ['Connection failed'] },
      })

      expect(screen.getByTitle('Show sync errors')).toBeInTheDocument()
    })

    it('hides sync error badge when syncErrors is empty', () => {
      render(AppTopNav, {
        props: { ...baseProps, syncErrors: [] },
      })

      expect(screen.queryByTitle('Show sync errors')).not.toBeInTheDocument()
    })

    it('calls onToggleSyncErrors when error badge is clicked', async () => {
      const onToggleSyncErrors = vi.fn()
      render(AppTopNav, {
        props: { ...baseProps, syncErrors: ['Error'], onToggleSyncErrors },
      })

      await fireEvent.click(screen.getByTitle('Show sync errors'))

      expect(onToggleSyncErrors).toHaveBeenCalledTimes(1)
    })

    it('shows sync error popup with errors when showSyncErrors is true', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          syncErrors: ['Connection failed', 'Timeout'],
          showSyncErrors: true,
        },
      })

      expect(screen.getByText('Sync errors')).toBeInTheDocument()
      expect(screen.getByText('Connection failed')).toBeInTheDocument()
      expect(screen.getByText('Timeout')).toBeInTheDocument()
    })

    it('hides sync error popup when showSyncErrors is false', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          syncErrors: ['Connection failed'],
          showSyncErrors: false,
        },
      })

      expect(screen.queryByText('Sync errors')).not.toBeInTheDocument()
    })
  })

  describe('hosted handle pill', () => {
    it('shows handle pill when hostedHandlePill and onOpenSettings provided', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          hostedHandlePill: 'testuser',
          onOpenSettings: vi.fn(),
        },
      })

      expect(screen.getByText('@testuser')).toBeInTheDocument()
    })

    it('adds pending-invite marker class on handle when shareInviteBadge', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          hostedHandlePill: 'testuser',
          onOpenSettings: vi.fn(),
          shareInviteBadge: true,
        },
      })
      expect(screen.getByRole('button', { name: /@testuser/i })).toHaveClass('nav-hosted-handle--badge')
    })

    it('adds pending-invite badge class on mobile Settings when shareInviteBadge', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          isMobile: true,
          hostedHandlePill: 'testuser',
          onOpenSettings: vi.fn(),
          onOpenSharing: vi.fn(),
          shareInviteBadge: true,
        },
      })
      expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass('settings-nav-btn--badge')
    })

    it('calls onOpenSharing when handle pill clicked with pending invite badge', async () => {
      const onOpenSettings = vi.fn()
      const onOpenSharing = vi.fn()
      render(AppTopNav, {
        props: {
          ...baseProps,
          hostedHandlePill: 'testuser',
          onOpenSettings,
          onOpenSharing,
          shareInviteBadge: true,
        },
      })
      await fireEvent.click(screen.getByText('@testuser'))
      expect(onOpenSharing).toHaveBeenCalledTimes(1)
      expect(onOpenSettings).not.toHaveBeenCalled()
    })

    it('hides handle pill when hostedHandlePill not provided', () => {
      render(AppTopNav, {
        props: { ...baseProps, onOpenSettings: vi.fn() },
      })

      expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    })

    it('hides handle pill when onOpenSettings not provided', () => {
      render(AppTopNav, {
        props: { ...baseProps, hostedHandlePill: 'testuser' },
      })

      expect(screen.queryByText('@testuser')).not.toBeInTheDocument()
    })

    it('calls onOpenSettings when handle pill is clicked', async () => {
      const onOpenSettings = vi.fn()
      render(AppTopNav, {
        props: {
          ...baseProps,
          hostedHandlePill: 'testuser',
          onOpenSettings,
        },
      })

      await fireEvent.click(screen.getByText('@testuser'))

      expect(onOpenSettings).toHaveBeenCalledTimes(1)
    })

    it('hides handle pill on mobile so the bar stays scannable (open Activity → Settings)', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          hostedHandlePill: 'testuser',
          onOpenSettings: vi.fn(),
          isMobile: true,
        },
      })

      expect(screen.queryByText('@testuser')).not.toBeInTheDocument()
    })

    it('shows Settings control on mobile when onOpenSettings is provided', async () => {
      const onOpenSettings = vi.fn()
      render(AppTopNav, {
        props: {
          ...baseProps,
          onOpenSettings,
          isMobile: true,
        },
      })
      await fireEvent.click(screen.getByRole('button', { name: /^settings$/i }))
      expect(onOpenSettings).toHaveBeenCalledTimes(1)
    })

    it('opens anchored overflow menu from ⋯ on mobile compact layout', async () => {
      render(AppTopNavMobileOverflowHarness)

      await fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
      expect(screen.getByRole('menu', { name: 'More actions' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Test row' })).toBeInTheDocument()
    })

    it('does not show separate Settings label next to Wiki when hosted handle is present (desktop)', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          hostedHandlePill: 'acme',
          onOpenSettings: vi.fn(),
          isMobile: false,
        },
      })
      expect(screen.getByText('@acme')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^settings$/i })).not.toBeInTheDocument()
    })
  })

  describe('mobile compact nav center title', () => {
    it('renders center title as clickable button when mobile compact nav is active', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          isMobile: true,
          mobileCenterTitle: 'Braintunnel',
          mobileOverflow: () => {},
        },
      })
      const title = screen.getByRole('button', { name: 'Braintunnel - Open sidebar' })
      expect(title).toHaveTextContent('Braintunnel')
    })

    it('calls onToggleSidebar when mobile center title is clicked', async () => {
      const onToggleSidebar = vi.fn()
      render(AppTopNav, {
        props: {
          ...baseProps,
          onToggleSidebar,
          isMobile: true,
          mobileCenterTitle: 'Chat',
          mobileOverflow: () => {},
        },
      })
      const title = screen.getByRole('button', { name: 'Chat - Open sidebar' })
      await fireEvent.click(title)
      expect(onToggleSidebar).toHaveBeenCalledTimes(1)
    })
  })
})
