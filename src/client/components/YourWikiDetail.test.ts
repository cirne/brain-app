import { describe, it, expect, vi, afterEach } from 'vitest'
import YourWikiDetail from './YourWikiDetail.svelte'
import { render, waitFor } from '@client/test/render.js'
import {
  YOUR_WIKI_HEADER,
  type YourWikiHeaderCell,
  type YourWikiHeaderState,
} from '@client/lib/yourWikiHeaderContext.js'
import { makeSlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'
import { yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'
import type { BackgroundAgentDoc } from '@client/lib/statusBar/backgroundAgentTypes.js'

vi.mock('@components/statusBar/BackgroundAgentPanel.svelte', () =>
  import('./test-stubs/BackgroundAgentPanelStub.svelte'),
)

function makeDoc(phase: BackgroundAgentDoc['phase'], pageCount = 0): BackgroundAgentDoc {
  return {
    id: 'bg_1',
    phase,
    detail: '',
    pageCount,
    timeline: [],
    lapTokenUsage: null,
    activeRunId: null,
  } as unknown as BackgroundAgentDoc
}

describe('YourWikiDetail.svelte slide header cell (BUG-047)', () => {
  afterEach(() => {
    yourWikiDocFromEvents.set(null)
  })

  it('claims the your-wiki header cell with stable pause/resume handlers', async () => {
    const cell: YourWikiHeaderCell = makeSlideHeaderCell<YourWikiHeaderState>()
    const context = new Map<symbol, YourWikiHeaderCell>([[YOUR_WIKI_HEADER, cell]])

    render(YourWikiDetail, {
      props: { onOpenWiki: () => {} },
      context,
    } as unknown as Parameters<typeof render>[1])

    await waitFor(() => {
      expect(cell.claimed).toBe(true)
    })

    const pauseRef = cell.current?.pause
    const resumeRef = cell.current?.resume
    expect(typeof pauseRef).toBe('function')
    expect(typeof resumeRef).toBe('function')
    expect(cell.current?.doc).toBeNull()

    // New BackgroundAgentDoc arrives via the events store: should patch `doc` without
    // rebuilding pause/resume handler refs.
    yourWikiDocFromEvents.set(makeDoc('idle'))
    await waitFor(() => {
      expect(cell.current?.doc).not.toBeNull()
    })
    expect(cell.current?.pause).toBe(pauseRef)
    expect(cell.current?.resume).toBe(resumeRef)
  })
})
