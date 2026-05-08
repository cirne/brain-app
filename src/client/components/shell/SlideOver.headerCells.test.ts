import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tick } from 'svelte'
import SlideOver from './SlideOver.svelte'
import { render, screen, waitFor } from '@client/test/render.js'
import type { Overlay } from '@client/router.js'
import type { ComponentProps } from 'svelte'

/**
 * BUG-047 regression: SlideOver mounts real WikiDirList; wiki header cell is claimed without
 * per-render churn when unrelated props change.
 */

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
vi.mock('../Wiki.svelte', () => import('../test-stubs/WikiStub.svelte'))

type SlideOverProps = ComponentProps<typeof SlideOver>

function baseProps(overrides: Partial<SlideOverProps> = {}): SlideOverProps {
  return {
    overlay: { type: 'wiki-dir', path: 'subdir' } as Overlay,
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

describe('SlideOver L2 header cells (BUG-047 integration)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    global.ResizeObserver = class ResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      constructor(_callback: ResizeObserverCallback) {
        /* no-op */
      }
    } as unknown as typeof ResizeObserver

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ files: [{ path: 'subdir/note.md', name: 'note.md' }] }), {
        status: 200,
      }) as Response
    }) as typeof fetch
  })

  it('renders wiki-dir rows without share chrome; survives benign SlideOver prop churn', async () => {
    const { rerender } = render(SlideOver, { props: baseProps() })

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: /^Share$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /note/i })).toBeInTheDocument()

    await rerender(baseProps({ wikiRefreshKey: 1 }))
    await tick()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /note/i })).toBeInTheDocument()
    })
  })
})
