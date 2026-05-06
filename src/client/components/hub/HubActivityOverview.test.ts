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

  it('uses activity spinner as mail row lead icon when mail sync is running', () => {
    render(HubActivityOverview, {
      props: {
        mailStatus: {
          configured: true,
          indexedTotal: 99,
          lastSyncedAt: '2026-01-01T00:00:00.000Z',
          dateRange: { from: null, to: null },
          syncRunning: true,
          refreshRunning: false,
          backfillRunning: false,
          syncLockAgeMs: null,
          ftsReady: 99,
          messageAvailableForProgress: 99,
          pendingBackfill: false,
          staleMailSyncLock: false,
        },
        mailLoading: false,
        wikiTitle: 'Wiki idle',
        wikiSubtitle: 'Ready',
        wikiPhase: 'idle',
        wikiIsActive: false,
        wikiIsPaused: false,
        wikiIsIdle: true,
        showWikiControls: false,
        syncBusy: false,
        wikiUpdateBusy: false,
        wikiActionBusy: false,
        indexFeedSummary: '1 mailbox',
        sourcesEmpty: false,
        sourcesError: null,
      },
    })

    const overview = document.querySelector('.hub-overview')
    expect(overview).toBeTruthy()
    const spinners = overview!.querySelectorAll('.spin-icon')
    expect(spinners.length).toBe(1)
  })

  it('disables Sync mail now and sets aria-busy while syncBusy', () => {
    render(HubActivityOverview, {
      props: {
        mailStatus: {
          configured: true,
          indexedTotal: 100,
          lastSyncedAt: null,
          dateRange: { from: null, to: null },
          syncRunning: false,
          refreshRunning: false,
          backfillRunning: false,
          syncLockAgeMs: null,
          ftsReady: 100,
          messageAvailableForProgress: 100,
          pendingBackfill: false,
          staleMailSyncLock: false,
        },
        mailLoading: false,
        wikiTitle: 'Wiki is up to date',
        wikiSubtitle: 'Ready',
        wikiPhase: 'idle',
        wikiIsActive: false,
        wikiIsPaused: false,
        wikiIsIdle: true,
        showWikiControls: false,
        syncBusy: true,
        wikiUpdateBusy: false,
        wikiActionBusy: false,
        indexFeedSummary: '1 mailbox',
        sourcesEmpty: false,
        sourcesError: null,
        onSyncNow: vi.fn(),
        onOpenSettings: vi.fn(),
      },
    })

    const btn = screen.getByRole('button', { name: /sync mail now/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })
})
