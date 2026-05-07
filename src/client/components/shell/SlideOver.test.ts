import { describe, it, expect, vi, beforeEach } from 'vitest'
import SlideOver from './SlideOver.svelte'
import { render, screen, fireEvent } from '@client/test/render.js'
import type { Overlay, SurfaceContext } from '@client/router.js'
import type { ComponentProps } from 'svelte'

vi.mock('../Wiki.svelte', () => import('../test-stubs/WikiStub.svelte'))
vi.mock('../WikiDirList.svelte', () => import('../test-stubs/WikiDirListStub.svelte'))
vi.mock('../FileViewer.svelte', () => import('../test-stubs/FileViewerStub.svelte'))
vi.mock('../Inbox.svelte', () => import('../test-stubs/InboxStub.svelte'))
vi.mock('../Calendar.svelte', () => import('../test-stubs/CalendarStub.svelte'))
vi.mock('../MessageThread.svelte', () => import('../test-stubs/MessageThreadStub.svelte'))
vi.mock('../MailSearchResultsPanel.svelte', () => import('../test-stubs/MailSearchResultsPanelStub.svelte'))
vi.mock('../PhoneAccessPanel.svelte', () => import('../test-stubs/PhoneAccessPanelStub.svelte'))
vi.mock('../YourWikiDetail.svelte', () => import('../test-stubs/YourWikiDetailStub.svelte'))
vi.mock('../hub-connector/HubConnectorSourcePanel.svelte', () =>
  import('../test-stubs/HubConnectorSourcePanelStub.svelte'),
)
vi.mock('../HubWikiAboutPanel.svelte', () => import('../test-stubs/HubWikiAboutPanelStub.svelte'))
vi.mock('../HubAddFoldersPanel.svelte', () => import('../test-stubs/HubAddFoldersPanelStub.svelte'))
vi.mock('../HubAppleMessagesPanel.svelte', () => import('../test-stubs/HubAppleMessagesPanelStub.svelte'))
vi.mock('../EmailDraftEditor.svelte', () => import('../test-stubs/EmailDraftEditorStub.svelte'))

type SlideOverProps = ComponentProps<SlideOver>

function baseProps(overrides: Partial<SlideOverProps> = {}): SlideOverProps {
  return {
    overlay: { type: 'wiki' } as Overlay,
    wikiRefreshKey: 0,
    calendarRefreshKey: 0,
    inboxTargetId: undefined,
    onWikiNavigate: vi.fn(),
    onInboxNavigate: vi.fn(),
    onContextChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

describe('SlideOver.svelte', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    global.ResizeObserver = class ResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      constructor(_callback: ResizeObserverCallback) {
        /* no-op */
      }
    } as any
  })

  it('renders with wiki overlay', () => {
    const props = baseProps({ overlay: { type: 'wiki', path: 'test.md' } })
    render(SlideOver, { props })

    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close panel/i })).toBeInTheDocument()
  })

  it('renders wiki page breadcrumbs from wiki root', async () => {
    const props = baseProps({ overlay: { type: 'wiki', path: 'travel.md' } })
    render(SlideOver, { props })

    const nav = screen.getByRole('navigation', { name: /wiki page path/i })
    expect(nav).toBeInTheDocument()
    expect(screen.getByText('travel.md')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Wiki' })).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /show full path/i }))
    expect(screen.getByRole('menuitem', { name: 'Wiki' })).toBeInTheDocument()
  })

  it('nested index.md shows directory link plus filename crumb', async () => {
    const props = baseProps({ overlay: { type: 'wiki', path: 'projects/index.md' } })
    render(SlideOver, { props })

    expect(screen.getByText('index.md')).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: /show full path/i }))
    expect(screen.getByRole('menuitem', { name: 'Wiki' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Projects' })).toBeInTheDocument()
  })

  it('renders filename with .md extension in breadcrumb', async () => {
    const props = baseProps({ overlay: { type: 'wiki', path: 'boys-trip-2026/Boys Trip 2026.md' } })
    render(SlideOver, { props })

    const nav = screen.getByRole('navigation', { name: /wiki page path/i })
    expect(nav).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: /show full path/i }))
    expect(screen.getByRole('menuitem', { name: 'Wiki' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Boys Trip 2026' })).toBeInTheDocument()

    expect(screen.getByText('Boys Trip 2026.md')).toBeInTheDocument()
  })

  it('personal unified path: My Wiki and People navigate under me/', async () => {
    const onWikiDirNavigate = vi.fn()
    const props = baseProps({
      overlay: { type: 'wiki', path: 'me/people/joshua-cano.md' },
      onWikiDirNavigate,
    })
    render(SlideOver, { props })

    await fireEvent.click(screen.getByRole('button', { name: /show full path/i }))
    expect(screen.queryByRole('menuitem', { name: 'Wiki' })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('menuitem', { name: 'My Wiki' }))
    expect(onWikiDirNavigate).toHaveBeenLastCalledWith('me')

    await fireEvent.click(screen.getByRole('button', { name: /show full path/i }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'People' }))
    expect(onWikiDirNavigate).toHaveBeenLastCalledWith('me/people')
  })

  it('shared wiki path lists @handle then folder in dropdown', async () => {
    const props = baseProps({
      overlay: { type: 'wiki', path: 'people/x.md', shareHandle: 'alice' },
    })
    render(SlideOver, { props })

    await fireEvent.click(screen.getByRole('button', { name: /show full path/i }))
    expect(screen.getByRole('menuitem', { name: '@alice' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'People' })).toBeInTheDocument()
  })

  it('renders wiki-dir at personal browse root as My Wiki without folder menu', () => {
    const props = baseProps({ overlay: { type: 'wiki-dir', path: 'me' } })
    render(SlideOver, { props })
    expect(screen.queryByRole('button', { name: /show full path/i })).not.toBeInTheDocument()
    expect(screen.getByText('My Wiki')).toBeInTheDocument()
  })

  it('renders with email overlay', () => {
    const surfaceContext: SurfaceContext = {
      type: 'email',
      threadId: '123',
      subject: 'Test Email',
      from: 'test@example.com',
    }
    const props = baseProps({
      overlay: { type: 'email', id: '123' },
      surfaceContext,
    })
    render(SlideOver, { props })

    expect(screen.getByText(/Test Email/i)).toBeInTheDocument()
  })

  it('renders with calendar overlay and shows Calendar title', () => {
    const props = baseProps({
      overlay: { type: 'calendar', date: '2024-01-15' },
    })
    render(SlideOver, { props })

    expect(screen.getByText('Calendar')).toBeInTheDocument()
    expect(screen.getByTestId('calendar-stub')).toBeInTheDocument()
  })

  it('renders with messages overlay', () => {
    const surfaceContext: SurfaceContext = {
      type: 'messages',
      chat: '+15551234567',
      displayLabel: 'John Doe',
    }
    const props = baseProps({
      overlay: { type: 'messages', chat: '+15551234567' },
      surfaceContext,
    })
    render(SlideOver, { props })

    expect(screen.getByText(/John Doe/i)).toBeInTheDocument()
  })

  it('renders with mail-search overlay', () => {
    const props = baseProps({
      overlay: { type: 'mail-search', id: 'search-1', query: 'Donna' },
      mailSearchResults: {
        queryLine: 'Search mail: Donna',
        items: [{ id: 'msg-1', subject: 'Hello', from: 'a@example.com', snippet: 'Body' }],
        totalMatched: 1,
      },
    })
    render(SlideOver, { props })

    expect(screen.getByText('Mail search')).toBeInTheDocument()
    expect(screen.getByTestId('mail-search-results-panel-stub')).toHaveTextContent('Search mail: Donna')
  })

  it('renders with your-wiki overlay', () => {
    const props = baseProps({ overlay: { type: 'your-wiki' } })
    render(SlideOver, { props })

    expect(screen.getByText('Your Wiki')).toBeInTheDocument()
    expect(screen.getByTestId('your-wiki-stub')).toBeInTheDocument()
  })

  it('renders with hub-source overlay', () => {
    const props = baseProps({ overlay: { type: 'hub-source', id: 'test-source' } })
    render(SlideOver, { props })

    expect(screen.getByText('Search index source')).toBeInTheDocument()
    expect(screen.getByTestId('hub-source-stub')).toBeInTheDocument()
  })

  it('renders with hub-wiki-about overlay', () => {
    const props = baseProps({ overlay: { type: 'hub-wiki-about' } })
    render(SlideOver, { props })

    expect(screen.getByText('Your wiki')).toBeInTheDocument()
    expect(screen.getByTestId('hub-wiki-about-stub')).toBeInTheDocument()
  })

  it('renders email-draft overlay with draft editor stub', () => {
    const surfaceContext: SurfaceContext = {
      type: 'email-draft',
      draftId: 'draft-1',
      subject: 'Hi',
      toLine: '',
      bodyPreview: '',
    }
    const props = baseProps({
      overlay: { type: 'email-draft', id: 'draft-1' },
      surfaceContext,
    })
    render(SlideOver, { props })

    expect(screen.getByTestId('email-draft-editor-stub')).toHaveTextContent(/draft-1/)
  })

  it('renders with file overlay', () => {
    const props = baseProps({ overlay: { type: 'file', path: '/path/to/doc.pdf' } })
    render(SlideOver, { props })

    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
  })

  it('renders with wiki-dir overlay', async () => {
    const props = baseProps({
      overlay: { type: 'wiki-dir', path: 'subdir' },
    })
    render(SlideOver, { props })

    expect(screen.getByRole('navigation', { name: /wiki page path/i })).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /show full path/i }))
    expect(screen.getByRole('menuitem', { name: 'Wiki' })).toBeInTheDocument()

    expect(screen.getByText('subdir')).toBeInTheDocument()
  })

  it('renders wiki-dir hub (no path) as wiki root label', () => {
    const props = baseProps({
      overlay: { type: 'wiki-dir', path: undefined },
    })
    render(SlideOver, { props })

    const nav = screen.getByRole('navigation', { name: /wiki page path/i })
    expect(nav).toBeInTheDocument()
    expect(screen.getByText('Wiki')).toBeInTheDocument()
  })

  describe('close behavior', () => {
    it('calls onClose when close button clicked (desktop)', async () => {
      const onClose = vi.fn()
      const props = baseProps({ overlay: { type: 'wiki' }, onClose })
      render(SlideOver, { props })

      const closeBtn = screen.getByRole('button', { name: /close panel/i })
      await fireEvent.click(closeBtn)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when back button clicked (mobile panel disabled)', async () => {
      const onClose = vi.fn()
      const props = baseProps({
        overlay: { type: 'wiki' },
        onClose,
        mobilePanel: false,
      })
      render(SlideOver, { props })

      const backBtn = screen.getByRole('button', { name: /back/i })
      await fireEvent.click(backBtn)

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('fullscreen toggle', () => {
    it('shows fullscreen button when onToggleFullscreen is provided and not mobile', () => {
      const onToggleFullscreen = vi.fn()
      const props = baseProps({
        overlay: { type: 'wiki' },
        onToggleFullscreen,
        mobilePanel: false,
      })
      render(SlideOver, { props })

      const fsBtn = screen.getByRole('button', { name: /fullscreen/i })
      expect(fsBtn).toBeInTheDocument()
    })

    it('calls onToggleFullscreen when fullscreen button clicked', async () => {
      const onToggleFullscreen = vi.fn()
      const props = baseProps({
        overlay: { type: 'wiki' },
        onToggleFullscreen,
        mobilePanel: false,
      })
      render(SlideOver, { props })

      const fsBtn = screen.getByRole('button', { name: /fullscreen/i })
      await fireEvent.click(fsBtn)

      expect(onToggleFullscreen).toHaveBeenCalledTimes(1)
    })

    it('shows exit fullscreen button when detailFullscreen is true', () => {
      const onToggleFullscreen = vi.fn()
      const props = baseProps({
        overlay: { type: 'wiki' },
        onToggleFullscreen,
        detailFullscreen: true,
        mobilePanel: false,
      })
      render(SlideOver, { props })

      const fsBtn = screen.getByRole('button', { name: /exit fullscreen/i })
      expect(fsBtn).toBeInTheDocument()
    })

    it('hides fullscreen button when mobilePanel is true', () => {
      const onToggleFullscreen = vi.fn()
      const props = baseProps({
        overlay: { type: 'wiki' },
        onToggleFullscreen,
        mobilePanel: true,
      })
      render(SlideOver, { props })

      const fsBtns = screen.queryAllByRole('button', { name: /fullscreen/i })
      expect(fsBtns.length).toBe(0)
    })
  })

  describe('mobile panel', () => {
    it('applies mobile-slide class when mobilePanel is true', () => {
      const props = baseProps({
        overlay: { type: 'wiki' },
        mobilePanel: true,
      })
      const { container } = render(SlideOver, { props })

      const slideOver = container.querySelector('.slide-over')
      expect(slideOver).toHaveClass('mobile-slide')
    })

    it('does not apply mobile-slide class when mobilePanel is false', () => {
      const props = baseProps({
        overlay: { type: 'wiki' },
        mobilePanel: false,
      })
      const { container } = render(SlideOver, { props })

      const slideOver = container.querySelector('.slide-over')
      expect(slideOver).not.toHaveClass('mobile-slide')
    })

    it('opens anchored page-actions menu from wiki overflow on mobile', async () => {
      const props = baseProps({
        overlay: { type: 'wiki', path: 'travel/trip.md' },
        mobilePanel: true,
      })
      render(SlideOver, { props })

      await fireEvent.click(screen.getByRole('button', { name: /more wiki actions/i }))
      expect(screen.getByRole('menu', { name: /page actions/i })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /^copy link$/i })).toBeInTheDocument()
    })
  })

  describe('data-overlay attribute', () => {
    it('sets data-overlay attribute to overlay type', () => {
      const props = baseProps({ overlay: { type: 'calendar', date: '2024-01-15' } })
      const { container } = render(SlideOver, { props })

      const slideOver = container.querySelector('.slide-over')
      expect(slideOver).toHaveAttribute('data-overlay', 'calendar')
    })
  })
})
