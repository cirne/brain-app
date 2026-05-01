import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { chmodSync } from 'node:fs'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setActualNativePort } from '@server/lib/platform/brainHttpPort.js'
import { NATIVE_APP_PORT_START } from '@server/lib/apple/nativeAppPort.js'

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

  it('POST /finalize runs finalize and marks done', async () => {
    interviewFinalizeMocks.runInterviewFinalize.mockClear()
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
  })

  it('POST /setup-mail returns 500 with error when ripmail exits non-zero', async () => {
    if (process.platform === 'win32') {
      return
    }
    const prevForce = process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS
    if (process.platform !== 'darwin') {
      process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS = '1'
    }
    const script = join(tmpdir(), `fake-ripmail-${Date.now()}.sh`)
    await writeFile(script, '#!/bin/sh\nexit 1\n')
    chmodSync(script, 0o755)
    const prevBin = process.env.RIPMAIL_BIN
    const prevHome = process.env.RIPMAIL_HOME
    const fakeHome = await mkdtemp(join(tmpdir(), 'ripmail-home-'))
    process.env.RIPMAIL_BIN = script
    process.env.RIPMAIL_HOME = fakeHome
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
      if (prevForce === undefined) delete process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS
      else process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS = prevForce
      if (prevBin === undefined) delete process.env.RIPMAIL_BIN
      else process.env.RIPMAIL_BIN = prevBin
      if (prevHome === undefined) delete process.env.RIPMAIL_HOME
      else process.env.RIPMAIL_HOME = prevHome
      await rm(script, { force: true })
      await rm(fakeHome, { recursive: true, force: true })
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

    it('localUrlScheme is https when BRAIN_BUNDLED_NATIVE=1', async () => {
      const prev = process.env.BRAIN_BUNDLED_NATIVE
      process.env.BRAIN_BUNDLED_NATIVE = '1'
      try {
        const app = new Hono()
        app.route('/api/onboarding', onboardingRoute)
        const res = await app.request('http://localhost/api/onboarding/network-info')
        expect(res.status).toBe(200)
        const j = (await res.json()) as { localUrlScheme: string }
        expect(j.localUrlScheme).toBe('https')
      } finally {
        if (prev === undefined) delete process.env.BRAIN_BUNDLED_NATIVE
        else process.env.BRAIN_BUNDLED_NATIVE = prev
      }
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
      delete process.env.BRAIN_BUNDLED_NATIVE
      delete process.env.PORT
      setActualNativePort(NATIVE_APP_PORT_START)
    })

    afterEach(() => {
      delete process.env.BRAIN_BUNDLED_NATIVE
      delete process.env.PORT
      setActualNativePort(NATIVE_APP_PORT_START)
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

    it('calls startTunnel with bound native port when BRAIN_BUNDLED_NATIVE=1 (ignores PORT)', async () => {
      process.env.BRAIN_BUNDLED_NATIVE = '1'
      process.env.PORT = '9999'
      const bound = NATIVE_APP_PORT_START + 1
      setActualNativePort(bound)
      const app = new Hono()
      app.route('/api/onboarding', onboardingRoute)
      const res = await app.request('http://localhost/api/onboarding/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteAccessEnabled: true }),
      })
      expect(res.status).toBe(200)
      expect(tunnelMocks.startTunnel).toHaveBeenCalledTimes(1)
      expect(tunnelMocks.startTunnel).toHaveBeenCalledWith(bound)
    })
  })

  describe('PATCH /state indexing to onboarding-agent (mail threshold)', () => {
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
        syncLockAgeMs: null,
        ftsReady: 100,
        messageAvailableForProgress: 1000,
        pendingBackfill: true,
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
    })

    it('allows transition at or above minimum indexed count', async () => {
      vi.spyOn(onboardingMailStatus, 'getOnboardingMailStatus').mockResolvedValue({
        configured: true,
        indexedTotal: 200,
        lastSyncedAt: null,
        dateRange: { from: null, to: null },
        syncRunning: false,
        syncLockAgeMs: null,
        ftsReady: null,
        messageAvailableForProgress: 500,
        pendingBackfill: true,
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
