import { describe, it, expect, vi, beforeEach } from 'vitest'
import AppTopNav from './AppTopNav.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

vi.mock('./BrainHubWidget.svelte', () => import('./test-stubs/BrainHubWidgetStub.svelte'))

describe('AppTopNav.svelte', () => {
  const baseProps = {
    onToggleSidebar: vi.fn(),
    syncErrors: [] as string[],
    showSyncErrors: false,
    onOpenSearch: vi.fn(),
    onToggleSyncErrors: vi.fn(),
    onOpenHub: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic rendering', () => {
    it('renders nav element with search and hub buttons', () => {
      render(AppTopNav, { props: baseProps })

      expect(screen.getByRole('navigation')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
      expect(screen.getByTestId('brain-hub-widget-stub')).toBeInTheDocument()
    })

    it('shows Braintunnel brand when sidebar is collapsed', () => {
      render(AppTopNav, { props: baseProps })

      expect(screen.getByText('Braintunnel')).toBeInTheDocument()
    })

    it('orders top actions search, then new chat, then hub (reading / tab order)', () => {
      render(AppTopNav, {
        props: { ...baseProps, onNewChat: vi.fn(), isEmptyChat: false },
      })
      const search = screen.getByRole('button', { name: 'Search' })
      const newChat = screen.getByRole('button', { name: 'New conversation' })
      const hub = screen.getByTestId('brain-hub-widget-stub')
      const after = globalThis.Node.DOCUMENT_POSITION_FOLLOWING
      expect(search.compareDocumentPosition(newChat) & after).toBe(after)
      expect(newChat.compareDocumentPosition(hub) & after).toBe(after)
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
    it('shows new chat button when onNewChat provided and chat is not empty', () => {
      render(AppTopNav, {
        props: { ...baseProps, onNewChat: vi.fn(), isEmptyChat: false },
      })

      expect(screen.getByRole('button', { name: 'New conversation' })).toBeInTheDocument()
    })

    it('hides new chat button when isEmptyChat is true', () => {
      render(AppTopNav, {
        props: { ...baseProps, onNewChat: vi.fn(), isEmptyChat: true },
      })

      expect(screen.queryByRole('button', { name: 'New conversation' })).not.toBeInTheDocument()
    })

    it('hides new chat button when onNewChat is not provided', () => {
      render(AppTopNav, {
        props: { ...baseProps, isEmptyChat: false },
      })

      expect(screen.queryByRole('button', { name: 'New conversation' })).not.toBeInTheDocument()
    })

    it('calls onNewChat when new chat button is clicked', async () => {
      const onNewChat = vi.fn()
      render(AppTopNav, {
        props: { ...baseProps, onNewChat, isEmptyChat: false },
      })

      await fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))

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

  describe('hub widget', () => {
    it('calls onOpenHub when hub widget is clicked', async () => {
      const onOpenHub = vi.fn()
      render(AppTopNav, {
        props: { ...baseProps, onOpenHub },
      })

      await fireEvent.click(screen.getByTestId('brain-hub-widget-stub'))

      expect(onOpenHub).toHaveBeenCalledTimes(1)
    })
  })

  describe('hosted handle pill', () => {
    it('shows handle pill when hostedHandlePill and onHostedHandleNavigate provided', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          hostedHandlePill: 'testuser',
          onHostedHandleNavigate: vi.fn(),
        },
      })

      expect(screen.getByText('@testuser')).toBeInTheDocument()
    })

    it('hides handle pill when hostedHandlePill not provided', () => {
      render(AppTopNav, {
        props: { ...baseProps, onHostedHandleNavigate: vi.fn() },
      })

      expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    })

    it('hides handle pill when onHostedHandleNavigate not provided', () => {
      render(AppTopNav, {
        props: { ...baseProps, hostedHandlePill: 'testuser' },
      })

      expect(screen.queryByText('@testuser')).not.toBeInTheDocument()
    })

    it('calls onHostedHandleNavigate when handle pill is clicked', async () => {
      const onHostedHandleNavigate = vi.fn()
      render(AppTopNav, {
        props: {
          ...baseProps,
          hostedHandlePill: 'testuser',
          onHostedHandleNavigate,
        },
      })

      await fireEvent.click(screen.getByText('@testuser'))

      expect(onHostedHandleNavigate).toHaveBeenCalledTimes(1)
    })

    it('hides handle pill on mobile so the bar stays scannable (handle is on Hub)', () => {
      render(AppTopNav, {
        props: {
          ...baseProps,
          hostedHandlePill: 'testuser',
          onHostedHandleNavigate: vi.fn(),
          isMobile: true,
        },
      })

      expect(screen.queryByText('@testuser')).not.toBeInTheDocument()
    })
  })
})
