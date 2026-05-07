import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tick } from 'svelte'
import SlideOver from './SlideOver.svelte'
import { render, screen, waitFor } from '@client/test/render.js'
import type { Overlay } from '@client/router.js'
import type { ComponentProps } from 'svelte'

/**
 * BUG-047 regression: assert SlideOver renders L2 header chrome that reads from cell state
 * mutated by a child pane (here we use a real WikiDirList against a stub fetch).
 *
 * If the cell ever regresses to the legacy register/equals shape, the share button below
 * will not appear because nothing pushes the payload, or the assertion below will fail
 * because re-renders churn the claimed/cleared state.
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
// Intentionally NOT mocking Wiki / WikiDirList — we want the real cell consumers.
vi.mock('../Wiki.svelte', () => import('../test-stubs/WikiStub.svelte'))

type SlideOverProps = ComponentProps<SlideOver>

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
      return new Response(
        JSON.stringify({
          files: [{ path: 'me/subdir/note.md', name: 'note.md' }],
          shares: { owned: [], received: [] },
        }),
        { status: 200 },
      ) as Response
    }) as typeof fetch
  })

  it('claims the wiki cell from WikiDirList and shows the share button without churn on parent re-renders', async () => {
    const { rerender } = render(SlideOver, { props: baseProps() })

    // The share button appears once WikiDirList loads + claims the cell with canShare=true.
    // (subdir is shareable in the wiki vault namespace.)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Share/i })).toBeInTheDocument()
    })

    const initialBtn = screen.getByRole('button', { name: /Share/i })

    // Trigger an irrelevant prop change and confirm the header still renders the share button
    // after a tick — exercises the "no per-render claim/clear churn" guarantee.
    await rerender(baseProps({ wikiRefreshKey: 1 }))
    await tick()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Share/i })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Share/i })).toBe(initialBtn)
  })
})
