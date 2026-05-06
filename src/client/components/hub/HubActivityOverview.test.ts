import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@client/test/render.js'
import HubActivityOverview from './HubActivityOverview.svelte'

describe('HubActivityOverview.svelte', () => {
  it('renders status rows and wiki controls when wiki is idle', async () => {
    render(HubActivityOverview, {
      props: {
        mailStatus: {
          configured: true,
          indexedTotal: 12,
          lastSyncedAt: null,
          dateRange: { from: null, to: null },
          syncRunning: false,
          refreshRunning: false,
          backfillRunning: false,
          syncLockAgeMs: null,
          ftsReady: 12,
          messageAvailableForProgress: 12,
          pendingBackfill: false,
          staleMailSyncLock: false,
        },
        mailLoading: false,
        wikiTitle: 'Wiki is up to date',
        wikiSubtitle: 'Ready when you are',
        wikiPhase: 'idle',
        wikiIsActive: false,
        wikiIsPaused: false,
        wikiIsIdle: true,
        showWikiControls: true,
        syncBusy: false,
        wikiUpdateBusy: false,
        wikiActionBusy: false,
        indexFeedSummary: '1 mailbox',
        sourcesEmpty: false,
        sourcesError: null,
        onOpenSettings: vi.fn(),
        onWikiUpdateNow: vi.fn(),
        onPause: vi.fn(),
      },
    })

    expect(screen.getByRole('heading', { level: 2, name: /what.*running/i })).toBeInTheDocument()
    expect(screen.getByText(/12/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /update wiki now/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /manage in settings/i })).toBeInTheDocument()
  })
})
