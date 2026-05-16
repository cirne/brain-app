import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildBackgroundStatusPayload } from './buildBackgroundStatus.js'
import type { OnboardingMailStatusPayload } from '@server/lib/onboarding/onboardingMailStatus.js'

const baseMail = (): OnboardingMailStatusPayload => ({
  configured: true,
  indexedTotal: 600,
  lastSyncedAt: null,
  dateRange: {
    from: '2015-01-01T00:00:00.000Z',
    to: '2026-01-02T00:00:00.000Z',
  },
  syncRunning: false,
  refreshRunning: false,
  backfillRunning: false,
  syncLockAgeMs: null,
  ftsReady: 600,
  messageAvailableForProgress: 600,
  pendingBackfill: false,
  deepHistoricalPending: false,
  staleMailSyncLock: false,
  indexingHint: null,
})

describe('buildBackgroundStatusPayload', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('infers ~1y onboarding historical lane during indexing when backfill runs', async () => {
    const payload = await buildBackgroundStatusPayload({
      mail: { ...baseMail(), backfillRunning: true },
      state: 'indexing',
      wikiMeExists: false,
      wikiDoc: {
        id: 'your-wiki',
        kind: 'your-wiki',
        status: 'queued',
        label: 'Your Wiki',
        detail: '…',
        pageCount: 0,
        logLines: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        phase: 'idle',
        lap: 0,
      },
      onboardingFlowActive: true,
    })
    expect(payload.mail.backfillPhase).toBe('1y')
    expect(payload.onboarding.milestones.interviewReady).toBe(true)
  })

  it('interviewReady false during indexing when indexed below gate even if backfill runs', async () => {
    const payload = await buildBackgroundStatusPayload({
      mail: {
        ...baseMail(),
        indexedTotal: 400,
        ftsReady: 400,
        messageAvailableForProgress: 400,
        backfillRunning: true,
      },
      state: 'indexing',
      wikiMeExists: false,
      wikiDoc: {
        id: 'your-wiki',
        kind: 'your-wiki',
        status: 'queued',
        label: 'Your Wiki',
        detail: '…',
        pageCount: 0,
        logLines: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        phase: 'idle',
        lap: 0,
      },
      onboardingFlowActive: true,
    })
    expect(payload.onboarding.milestones.interviewReady).toBe(false)
  })

  it('marks milestones when onboarding is done and mail is idle', async () => {
    const payload = await buildBackgroundStatusPayload({
      mail: baseMail(),
      state: 'done',
      wikiMeExists: true,
      wikiDoc: {
        id: 'your-wiki',
        kind: 'your-wiki',
        status: 'running',
        label: 'Your Wiki',
        detail: 'Enriching',
        pageCount: 12,
        logLines: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        phase: 'enriching',
        lap: 2,
        lapMailSyncIncomplete: true,
      },
      onboardingFlowActive: false,
    })
    expect(payload.onboarding.milestones.wikiReady).toBe(false)
    expect(payload.wiki.lapMailSyncStale).toBe(true)
    expect(payload.wiki.autoStartEligible).toBe(false)
    expect(payload.mail.indexedHistoryDepthOk).toBe(true)
  })

  it('sets wikiReady false when done but indexed below wiki buildout gate', async () => {
    const payload = await buildBackgroundStatusPayload({
      mail: { ...baseMail(), indexedTotal: 800, ftsReady: 800 },
      state: 'done',
      wikiMeExists: true,
      wikiDoc: {
        id: 'your-wiki',
        kind: 'your-wiki',
        status: 'completed',
        label: 'Your Wiki',
        detail: 'Up to date',
        pageCount: 40,
        logLines: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        phase: 'idle',
        lap: 3,
      },
      onboardingFlowActive: false,
    })
    expect(payload.onboarding.milestones.wikiReady).toBe(false)
    expect(payload.wiki.autoStartEligible).toBe(false)
    expect(payload.mail.indexedHistoryDepthOk).toBe(true)
  })

  it('sets wikiReady when done and indexed crosses wiki gate', async () => {
    const payload = await buildBackgroundStatusPayload({
      mail: { ...baseMail(), indexedTotal: 1200, ftsReady: 1200 },
      state: 'done',
      wikiMeExists: true,
      wikiDoc: {
        id: 'your-wiki',
        kind: 'your-wiki',
        status: 'completed',
        label: 'Your Wiki',
        detail: 'Up to date',
        pageCount: 40,
        logLines: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        phase: 'idle',
        lap: 3,
      },
      onboardingFlowActive: false,
    })
    expect(payload.onboarding.milestones.wikiReady).toBe(true)
    expect(payload.wiki.autoStartEligible).toBe(true)
    expect(payload.mail.indexedHistoryDepthOk).toBe(true)
  })

  it('wikiReady false when done and history shallow even if message count crosses gate', async () => {
    const shallowFrom = new Date(Date.now() - 10 * 86_400_000).toISOString()
    const payload = await buildBackgroundStatusPayload({
      mail: {
        ...baseMail(),
        indexedTotal: 1200,
        ftsReady: 1200,
        dateRange: { from: shallowFrom, to: new Date().toISOString() },
      },
      state: 'done',
      wikiMeExists: true,
      wikiDoc: {
        id: 'your-wiki',
        kind: 'your-wiki',
        status: 'completed',
        label: 'Your Wiki',
        detail: 'Up to date',
        pageCount: 40,
        logLines: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        phase: 'idle',
        lap: 3,
      },
      onboardingFlowActive: false,
    })
    expect(payload.mail.indexedHistoryDepthOk).toBe(false)
    expect(payload.onboarding.milestones.wikiReady).toBe(false)
    expect(payload.wiki.autoStartEligible).toBe(false)
  })

  it('autoStartEligible during onboarding-agent when indexed crosses wiki gate', async () => {
    const payload = await buildBackgroundStatusPayload({
      mail: { ...baseMail(), indexedTotal: 1200, ftsReady: 1200 },
      state: 'onboarding-agent',
      wikiMeExists: true,
      wikiDoc: {
        id: 'your-wiki',
        kind: 'your-wiki',
        status: 'queued',
        label: 'Your Wiki',
        detail: '…',
        pageCount: 0,
        logLines: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        phase: 'idle',
        lap: 0,
      },
      onboardingFlowActive: true,
    })
    expect(payload.wiki.autoStartEligible).toBe(true)
    expect(payload.onboarding.milestones.wikiReady).toBe(false)
  })

  it('autoStartEligible false when mail not configured even if counts high', async () => {
    const payload = await buildBackgroundStatusPayload({
      mail: { ...baseMail(), configured: false, indexedTotal: 1200, ftsReady: 1200 },
      state: 'indexing',
      wikiMeExists: false,
      wikiDoc: {
        id: 'your-wiki',
        kind: 'your-wiki',
        status: 'queued',
        label: 'Your Wiki',
        detail: '…',
        pageCount: 0,
        logLines: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        phase: 'idle',
        lap: 0,
      },
      onboardingFlowActive: true,
    })
    expect(payload.wiki.autoStartEligible).toBe(false)
  })
})
