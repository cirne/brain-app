import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const tunnelMocks = vi.hoisted(() => ({
  startTunnel: vi.fn().mockResolvedValue(null),
  stopTunnel: vi.fn(),
  getActiveTunnelUrl: vi.fn((): string | null => null),
}))

vi.mock('@server/lib/platform/tunnelManager.js', () => ({
  startTunnel: tunnelMocks.startTunnel,
  stopTunnel: tunnelMocks.stopTunnel,
  getActiveTunnelUrl: tunnelMocks.getActiveTunnelUrl,
}))

const interviewFinalizeMocks = vi.hoisted(() => ({
  runInterviewFinalize: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../agent/interviewFinalizeAgent.js', () => ({
  runInterviewFinalize: interviewFinalizeMocks.runInterviewFinalize,
}))

const ripmailRefreshMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, messagesAdded: 0, messagesUpdated: 0 }))

const yourWikiMocks = vi.hoisted(() => ({
  ensureYourWikiRunning: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@server/ripmail/sync/index.js', () => ({
  refresh: ripmailRefreshMock,
}))

vi.mock('@server/ripmail/db.js', () => ({
  openRipmailDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: vi.fn() })),
  })),
}))

vi.mock('../agent/yourWikiSupervisor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent/yourWikiSupervisor.js')>()
  return {
    ...actual,
    ensureYourWikiRunning: yourWikiMocks.ensureYourWikiRunning,
  }
})

import onboardingRoute from './onboarding.js'
import * as onboardingMailStatus from '@server/lib/onboarding/onboardingMailStatus.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import {
  registerIdentityUserId,
  registerIdentityWorkspace,
  registerSessionTenant,
} from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { generateUserId, writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { googleIdentityKey } from '@server/lib/tenant/googleIdentityWorkspace.js'
import { BRAIN_FINISH_CONVERSATION_SUBMIT } from '@shared/finishConversationShortcut.js'

/** Avoid async wiki-expansion I/O racing with `afterEach` `rm(BRAIN_HOME)`. */
vi.mock('../agent/wikiExpansionRunner.js', () => ({
  startWikiExpansionRunFromAcceptProfile: vi.fn().mockResolvedValue({
    runId: '00000000-0000-0000-0000-000000000000',
  }),
}))

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'onboarding-api-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('onboarding routes', () => {
  it('GET /fda returns { granted: boolean }', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/fda')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { granted: boolean }
    expect(typeof j.granted).toBe('boolean')
  })

  it('GET /fda?detail=1 returns per-path probe rows', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/fda?detail=1')
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      granted: boolean
      probes: unknown[]
      pid: number
      home: string
    }
    expect(typeof j.granted).toBe('boolean')
    expect(Array.isArray(j.probes)).toBe(true)
    expect(typeof j.pid).toBe('number')
    expect(typeof j.home).toBe('string')
  })

  it('GET /status returns state and wikiMeExists', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/status')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { state: string; wikiMeExists: boolean }
    expect(j.state).toBe('not-started')
    expect(j.wikiMeExists).toBe(false)
  })

  it('PATCH /state reset', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { state: string }
    expect(j.state).toBe('not-started')
  })

  it('PATCH /state returns 400 for invalid transition', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /state returns 409 when onboarding is done and client tries indexing', async () => {
    const { setOnboardingStateForce } = await import('@server/lib/onboarding/onboardingState.js')
    await setOnboardingStateForce('done')
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'indexing' }),
    })
    expect(res.status).toBe(409)
    const j = (await res.json()) as { code?: string }
    expect(j.code).toBe('onboarding_complete')
  })

  it('PATCH /state allows not-started after done (re-run onboarding)', async () => {
    const { setOnboardingStateForce, readOnboardingStateDoc } = await import(
      '@server/lib/onboarding/onboardingState.js'
    )
    await setOnboardingStateForce('done')
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'not-started' }),
    })
    expect(res.status).toBe(200)
    const doc = await readOnboardingStateDoc()
    expect(doc.state).toBe('not-started')
  })

  it('DELETE /interview-sessions returns ok', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/interview-sessions', {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean }
    expect(j.ok).toBe(true)
  })

  it('POST /interview finish shortcut emits finish_conversation tool_end without agent LLM', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: BRAIN_FINISH_CONVERSATION_SUBMIT,
        userMessageDisplay: 'Done',
        timezone: 'UTC',
      }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('event: tool_end')
    expect(text).toContain('"name":"finish_conversation"')
  })

  it('POST /finalize returns 400 when not in onboarding-agent', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: '550e8400-e29b-41d4-a716-446655440000' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /finalize returns 200 when already done (idempotent)', async () => {
    interviewFinalizeMocks.runInterviewFinalize.mockClear()
    const { setOnboardingState } = await import('@server/lib/onboarding/onboardingState.js')
    await setOnboardingState('indexing')
    await setOnboardingState('onboarding-agent')
    await setOnboardingState('done')

    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: '550e8400-e29b-41d4-a716-446655440099' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; state: string }
    expect(j.ok).toBe(true)
    expect(j.state).toBe('done')
    expect(interviewFinalizeMocks.runInterviewFinalize).not.toHaveBeenCalled()
  })

  const mailPayloadLow = {
    configured: true,
    indexedTotal: 400,
    lastSyncedAt: null as string | null,
    dateRange: { from: null as string | null, to: null as string | null },
    syncRunning: false,
    refreshRunning: false,
    backfillRunning: false,
    syncLockAgeMs: null as number | null,
    ftsReady: 400,
    messageAvailableForProgress: 400,
    pendingBackfill: false,
    deepHistoricalPending: false,
    staleMailSyncLock: false,
  }

  const mailPayloadWikiReady = {
    ...mailPayloadLow,
    indexedTotal: 1500,
    ftsReady: 1500,
    messageAvailableForProgress: 1500,
  }

  it('POST /finalize runs finalize and marks done', async () => {
    interviewFinalizeMocks.runInterviewFinalize.mockClear()
    yourWikiMocks.ensureYourWikiRunning.mockClear()
    const mailSpy = vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(mailPayloadLow)
    const { setOnboardingState, readOnboardingStateDoc } = await import('@server/lib/onboarding/onboardingState.js')
    const sessionId = '550e8400-e29b-41d4-a716-446655440001'
    await setOnboardingState('indexing')
    await setOnboardingState('onboarding-agent')

    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, timezone: 'America/Chicago' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; state: string }
    expect(j.ok).toBe(true)
    expect(j.state).toBe('done')
    expect((await readOnboardingStateDoc()).state).toBe('done')
    expect(interviewFinalizeMocks.runInterviewFinalize).toHaveBeenCalledWith({
      sessionId,
      timezone: 'America/Chicago',
    })
    await vi.waitFor(() => {
      expect(yourWikiMocks.ensureYourWikiRunning).not.toHaveBeenCalled()
    })
    mailSpy.mockRestore()
  })

  it('POST /finalize kicks wiki supervisor when indexed count passes wiki-ready gate', async () => {
    interviewFinalizeMocks.runInterviewFinalize.mockClear()
    yourWikiMocks.ensureYourWikiRunning.mockClear()
    const mailSpy = vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue(mailPayloadWikiReady)
    const bootstrapSpy = vi.spyOn(await import('@server/lib/onboarding/onboardingState.js'), 'readWikiBootstrapState')
    bootstrapSpy.mockResolvedValue({
      status: 'completed',
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:00.000Z',
      stats: { peopleCreated: 0, projectsCreated: 0, topicsCreated: 0, travelCreated: 0 },
    })
    const { setOnboardingState } = await import('@server/lib/onboarding/onboardingState.js')
    const sessionId = '550e8400-e29b-41d4-a716-446655440002'
    await setOnboardingState('indexing')
    await setOnboardingState('onboarding-agent')

    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, timezone: 'UTC' }),
    })
    expect(res.status).toBe(200)
    await vi.waitFor(() => {
      expect(yourWikiMocks.ensureYourWikiRunning).toHaveBeenCalledTimes(1)
    })
    mailSpy.mockRestore()
    bootstrapSpy.mockRestore()
  })

  it('POST /setup-mail returns 500 when mail setup persistence fails', async () => {
    if (process.platform === 'win32') {
      return
    }
    const prevForce = process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS
    if (process.platform !== 'darwin') {
      process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS = '1'
    }
    const configMod = await import('@server/ripmail/sync/config.js')
    const spy = vi.spyOn(configMod, 'loadRipmailConfig').mockImplementationOnce(() => {
      throw new Error('config unavailable')
    })
    try {
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/setup-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(500)
      const j = (await res.json()) as { ok: boolean; error?: string }
      expect(j.ok).toBe(false)
      expect(j.error).toBeTruthy()
    } finally {
      spy.mockRestore()
      if (prevForce === undefined) delete process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS
      else process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS = prevForce
    }
  })

  it('POST /setup-mail returns 400 when Apple local integrations are unavailable', async () => {
    const prev = process.env.BRAIN_DISABLE_APPLE_LOCAL
    process.env.BRAIN_DISABLE_APPLE_LOCAL = '1'
    try {
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/setup-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const j = (await res.json()) as { ok: boolean; error?: string }
      expect(j.ok).toBe(false)
      expect(j.error).toBeTruthy()
    } finally {
      if (prev === undefined) delete process.env.BRAIN_DISABLE_APPLE_LOCAL
      else process.env.BRAIN_DISABLE_APPLE_LOCAL = prev
    }
  })

  describe('GET /network-info tunnel URL vs remoteAccessEnabled', () => {
    afterEach(() => {
      tunnelMocks.getActiveTunnelUrl.mockReset()
      tunnelMocks.getActiveTunnelUrl.mockImplementation((): string | null => null)
      tunnelMocks.stopTunnel.mockClear()
    })

    it('omits tunnelUrl and stops tunnel when remoteAccessEnabled is false', async () => {
      const { onboardingDataDir } = await import('@server/lib/onboarding/onboardingState.js')
      await mkdir(onboardingDataDir(), { recursive: true })
      await writeFile(
        join(onboardingDataDir(), 'preferences.json'),
        JSON.stringify({ remoteAccessEnabled: false }),
        'utf-8',
      )
      tunnelMocks.getActiveTunnelUrl.mockImplementation(() => 'https://fake.trycloudflare.com/')
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/network-info')
      expect(res.status).toBe(200)
      const j = (await res.json()) as { tunnelUrl: string | null; localUrlScheme: string }
      expect(j.tunnelUrl).toBeNull()
      expect(j.localUrlScheme).toBe('http')
      expect(tunnelMocks.stopTunnel).toHaveBeenCalled()
    })

    it('includes tunnelUrl when remoteAccessEnabled is true', async () => {
      const { onboardingDataDir } = await import('@server/lib/onboarding/onboardingState.js')
      await mkdir(onboardingDataDir(), { recursive: true })
      await writeFile(
        join(onboardingDataDir(), 'preferences.json'),
        JSON.stringify({ remoteAccessEnabled: true }),
        'utf-8',
      )
      tunnelMocks.getActiveTunnelUrl.mockImplementation(() => 'https://fake.trycloudflare.com/')
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/network-info')
      expect(res.status).toBe(200)
      const j = (await res.json()) as { tunnelUrl: string | null; localUrlScheme: string }
      expect(j.tunnelUrl).toBe('https://fake.trycloudflare.com/')
      expect(j.localUrlScheme).toBe('http')
      expect(tunnelMocks.stopTunnel).not.toHaveBeenCalled()
    })

  })

  it('GET /preferences includes appleLocalIntegrationsAvailable', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/preferences')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { appleLocalIntegrationsAvailable?: boolean }
    expect(typeof j.appleLocalIntegrationsAvailable).toBe('boolean')
  })

  it('PATCH /preferences returns 400 for mailProvider apple when Apple local integrations disabled', async () => {
    const prev = process.env.BRAIN_DISABLE_APPLE_LOCAL
    process.env.BRAIN_DISABLE_APPLE_LOCAL = '1'
    try {
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mailProvider: 'apple' }),
      })
      expect(res.status).toBe(400)
    } finally {
      if (prev === undefined) delete process.env.BRAIN_DISABLE_APPLE_LOCAL
      else process.env.BRAIN_DISABLE_APPLE_LOCAL = prev
    }
  })

  describe('PATCH /preferences remote access (tunnel target port)', () => {
    beforeEach(() => {
      tunnelMocks.startTunnel.mockClear()
      delete process.env.PORT
    })

    afterEach(() => {
      delete process.env.PORT
    })

    it('calls startTunnel(3000) in dev when PORT is unset', async () => {
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteAccessEnabled: true }),
      })
      expect(res.status).toBe(200)
      expect(tunnelMocks.startTunnel).toHaveBeenCalledTimes(1)
      expect(tunnelMocks.startTunnel).toHaveBeenCalledWith(3000)
    })

    it('calls startTunnel with PORT when set', async () => {
      process.env.PORT = '9999'
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteAccessEnabled: true }),
      })
      expect(res.status).toBe(200)
      expect(tunnelMocks.startTunnel).toHaveBeenCalledTimes(1)
      expect(tunnelMocks.startTunnel).toHaveBeenCalledWith(9999)
    })
  })

  describe('PATCH /state indexing to onboarding-agent (mail threshold)', () => {
    beforeEach(() => {
      ripmailRefreshMock.mockClear()
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('returns 400 when indexed count is below minimum', async () => {
      vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue({
        configured: true,
        indexedTotal: 100,
        lastSyncedAt: null,
        dateRange: { from: null, to: null },
        syncRunning: false,
        refreshRunning: false,
        backfillRunning: false,
        syncLockAgeMs: null,
        ftsReady: 100,
        messageAvailableForProgress: 1000,
        pendingBackfill: true,
        deepHistoricalPending: true,
        staleMailSyncLock: false,
      })
      const { setOnboardingState } = await import('@server/lib/onboarding/onboardingState.js')
      await setOnboardingState('indexing')
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'onboarding-agent' }),
      })
      expect(res.status).toBe(400)
      expect(ripmailRefreshMock).not.toHaveBeenCalled()
    })

    it('allows transition at or above minimum indexed count', async () => {
      vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue({
        configured: true,
        indexedTotal: 500,
        lastSyncedAt: null,
        dateRange: { from: null, to: null },
        syncRunning: false,
        refreshRunning: false,
        backfillRunning: false,
        syncLockAgeMs: null,
        ftsReady: null,
        messageAvailableForProgress: 500,
        pendingBackfill: true,
        deepHistoricalPending: true,
        staleMailSyncLock: false,
      })
      const { setOnboardingState } = await import('@server/lib/onboarding/onboardingState.js')
      await setOnboardingState('indexing')
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'onboarding-agent' }),
      })
      expect(res.status).toBe(200)
      const j = (await res.json()) as { state: string }
      expect(j.state).toBe('onboarding-agent')
      expect(ripmailRefreshMock).not.toHaveBeenCalled()
    })

    it('allows transition while onboarding ~1y historical lane still runs', async () => {
      vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue({
        configured: true,
        indexedTotal: 520,
        lastSyncedAt: null,
        dateRange: { from: null, to: null },
        syncRunning: true,
        refreshRunning: false,
        backfillRunning: true,
        syncLockAgeMs: 9000,
        ftsReady: 520,
        messageAvailableForProgress: null,
        pendingBackfill: false,
        deepHistoricalPending: true,
        staleMailSyncLock: false,
      })
      const { setOnboardingState } = await import('@server/lib/onboarding/onboardingState.js')
      await setOnboardingState('indexing')
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'onboarding-agent' }),
      })
      expect(res.status).toBe(200)
      const j = (await res.json()) as { state: string }
      expect(j.state).toBe('onboarding-agent')
      expect(ripmailRefreshMock).not.toHaveBeenCalled()
    })

    it('allows transition for a small inbox once initial mail sync has fully drained (below threshold)', async () => {
      vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue({
        configured: true,
        indexedTotal: 37,
        lastSyncedAt: '2026-05-07T18:00:00.000Z',
        dateRange: { from: null, to: null },
        syncRunning: false,
        refreshRunning: false,
        backfillRunning: false,
        syncLockAgeMs: null,
        ftsReady: 37,
        messageAvailableForProgress: 37,
        pendingBackfill: false,
        deepHistoricalPending: false,
        staleMailSyncLock: false,
        indexingHint: null,
      })
      const { setOnboardingState } = await import('@server/lib/onboarding/onboardingState.js')
      await setOnboardingState('indexing')
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'onboarding-agent' }),
      })
      expect(res.status).toBe(200)
      const j = (await res.json()) as { state: string }
      expect(j.state).toBe('onboarding-agent')
      expect(ripmailRefreshMock).not.toHaveBeenCalled()
    })

    it('still blocks below threshold when initial sync has not finished (lastSyncedAt null)', async () => {
      vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue({
        configured: true,
        indexedTotal: 37,
        lastSyncedAt: null,
        dateRange: { from: null, to: null },
        syncRunning: false,
        refreshRunning: false,
        backfillRunning: false,
        syncLockAgeMs: null,
        ftsReady: 37,
        messageAvailableForProgress: 37,
        pendingBackfill: false,
        deepHistoricalPending: true,
        staleMailSyncLock: false,
        indexingHint: null,
      })
      const { setOnboardingState } = await import('@server/lib/onboarding/onboardingState.js')
      await setOnboardingState('indexing')
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'onboarding-agent' }),
      })
      expect(res.status).toBe(400)
      expect(ripmailRefreshMock).not.toHaveBeenCalled()
    })
  })
})

describe('onboarding routes (multi-tenant handle gate)', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT

  beforeEach(() => {
    delete process.env.BRAIN_HOME
  })

  afterEach(async () => {
    delete process.env.BRAIN_DATA_ROOT
    if (prevRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevRoot
  })

  function mountMtOnboarding(): Hono {
    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.use('/api/*', vaultGateMiddleware)
    app.route('/api/onboarding', onboardingRoute)
    return app
  }

  it('GET /status surfaces confirming-handle until meta confirmed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ob-mt-st-'))
    process.env.BRAIN_DATA_ROOT = root

    const handle = 'ob-mt-handle'
    const key = googleIdentityKey('sub-ob-mt')
    ensureTenantHomeDir(handle)
    const uid = generateUserId()
    await registerIdentityWorkspace(key, handle)
    await registerIdentityUserId(key, uid)
    await writeHandleMeta(tenantHomeDir(handle), {
      userId: uid,
      handle,
      confirmedAt: null,
    })

    await runWithTenantContextAsync(
      { tenantUserId: handle, workspaceHandle: handle, homeDir: tenantHomeDir(handle) },
      async () => {
        await mkdir(join(tenantHomeDir(handle), 'wiki'), { recursive: true })
        await mkdir(join(tenantHomeDir(handle), 'chats'), { recursive: true })
        await writeFile(
          join(tenantHomeDir(handle), 'chats', 'onboarding.json'),
          JSON.stringify({ state: 'done', updatedAt: new Date().toISOString() }),
          'utf-8',
        )
      },
    )

    const sid = await runWithTenantContextAsync(
      { tenantUserId: handle, workspaceHandle: handle, homeDir: tenantHomeDir(handle) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, handle)

    const app = mountMtOnboarding()
    const res = await app.request('http://localhost/api/onboarding/status', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { state: string }
    expect(j.state).toBe('confirming-handle')

    await rm(root, { recursive: true, force: true })
  })

  it('PATCH /state rejects indexing until handle confirmed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ob-mt-patch-'))
    process.env.BRAIN_DATA_ROOT = root

    const handle = 'ob-mt-patch'
    const key = googleIdentityKey('sub-ob-patch')
    ensureTenantHomeDir(handle)
    const uid = generateUserId()
    await registerIdentityWorkspace(key, handle)
    await registerIdentityUserId(key, uid)
    await writeHandleMeta(tenantHomeDir(handle), {
      userId: uid,
      handle,
      confirmedAt: null,
    })

    await runWithTenantContextAsync(
      { tenantUserId: handle, workspaceHandle: handle, homeDir: tenantHomeDir(handle) },
      async () => {
        await mkdir(join(tenantHomeDir(handle), 'wiki'), { recursive: true })
        await mkdir(join(tenantHomeDir(handle), 'chats'), { recursive: true })
      },
    )

    const sid = await runWithTenantContextAsync(
      { tenantUserId: handle, workspaceHandle: handle, homeDir: tenantHomeDir(handle) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, handle)

    const app = mountMtOnboarding()
    const res = await app.request('http://localhost/api/onboarding/state', {
      method: 'PATCH',
      headers: {
        Cookie: `brain_session=${sid}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state: 'indexing' }),
    })
    expect(res.status).toBe(400)

    await rm(root, { recursive: true, force: true })
  })
})
