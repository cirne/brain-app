import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as onboardingMailStatus from '@server/lib/onboarding/onboardingMailStatus.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'bg-status-api-'))
  process.env.BRAIN_HOME = brainHome
  await mkdir(join(brainHome, 'chats'), { recursive: true })
  await writeFile(
    join(brainHome, 'chats', 'onboarding.json'),
    JSON.stringify({ state: 'done', updatedAt: '2026-01-01T00:00:00.000Z' }),
    'utf-8',
  )
  await mkdir(join(brainHome, 'wikis', 'me'), { recursive: true })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.restoreAllMocks()
})

describe('GET /api/background-status', () => {
  it('returns unified payload shape', async () => {
    vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue({
      configured: true,
      indexedTotal: 50,
      lastSyncedAt: null,
      dateRange: { from: null, to: null },
      syncRunning: false,
      refreshRunning: false,
      backfillRunning: false,
      syncLockAgeMs: null,
      ftsReady: 50,
      messageAvailableForProgress: 50,
      pendingBackfill: false,
      staleMailSyncLock: false,
      indexingHint: null,
    })

    const { default: backgroundStatusRoute } = await import('./backgroundStatus.js')
    const app = new Hono()
    app.route('/api/background-status', backgroundStatusRoute)
    const res = await app.request('http://localhost/api/background-status')
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      mail: { indexedTotal: number; phase1Complete: boolean }
      wiki: { pageCount: number; phase: string }
      onboarding: { state: string; milestones: Record<string, boolean> }
      onboardingFlowActive: boolean
    }
    expect(j.mail.indexedTotal).toBe(50)
    expect(typeof j.onboarding.milestones.interviewReady).toBe('boolean')
    expect(j.onboarding.state).toBe('done')
    expect(j.onboardingFlowActive).toBe(false)
    expect(typeof j.wiki.pageCount).toBe('number')
    expect(typeof j.wiki.phase).toBe('string')
  })
})
