import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { chmodSync } from 'node:fs'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setActualNativePort } from '../lib/brainHttpPort.js'
import { NATIVE_APP_PORT_START } from '../lib/nativeAppPort.js'

const tunnelMocks = vi.hoisted(() => ({
  startTunnel: vi.fn().mockResolvedValue(null),
  stopTunnel: vi.fn(),
  getActiveTunnelUrl: vi.fn((): string | null => null),
}))

vi.mock('../lib/tunnelManager.js', () => ({
  startTunnel: tunnelMocks.startTunnel,
  stopTunnel: tunnelMocks.stopTunnel,
  getActiveTunnelUrl: tunnelMocks.getActiveTunnelUrl,
}))

import onboardingRoute from './onboarding.js'

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
  const wikiDirPath = () => join(brainHome, 'wiki')

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

  it('GET /profile-draft returns 404 when no profile exists', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/profile-draft')
    expect(res.status).toBe(404)
  })

  it('GET /profile-draft returns wiki/me.md when present', async () => {
    await mkdir(wikiDirPath(), { recursive: true })
    await writeFile(join(wikiDirPath(), 'me.md'), '# Hello\n', 'utf-8')
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/profile-draft')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { path: string; markdown: string }
    expect(j.path).toBe('me.md')
    expect(j.markdown).toContain('Hello')
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

  it('PATCH /profile-draft writes markdown when state is reviewing-profile', async () => {
    const { setOnboardingState } = await import('../lib/onboardingState.js')
    const { profileDraftAbsolutePath } = await import('../lib/onboardingState.js')
    await mkdir(wikiDirPath(), { recursive: true })
    await writeFile(profileDraftAbsolutePath(), '---\na: 1\n---\n\n# Old\n', 'utf-8')
    await setOnboardingState('indexing')
    await setOnboardingState('profiling')
    await setOnboardingState('reviewing-profile')

    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/profile-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: '---\na: 1\n---\n\n# New\n' }),
    })
    expect(res.status).toBe(200)
    const text = await import('node:fs/promises').then((fs) => fs.readFile(profileDraftAbsolutePath(), 'utf-8'))
    expect(text).toContain('# New')
  })

  it('PATCH /profile-draft returns 400 when not in reviewing-profile', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/profile-draft', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: '# x\n' }),
    })
    expect(res.status).toBe(400)
  })

  it('DELETE /profiling-sessions returns ok', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/profiling-sessions', {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean }
    expect(j.ok).toBe(true)
  })

  it('POST /setup-mail returns 500 with error when ripmail exits non-zero', async () => {
    if (process.platform === 'win32') {
      return
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
      if (prevBin === undefined) delete process.env.RIPMAIL_BIN
      else process.env.RIPMAIL_BIN = prevBin
      if (prevHome === undefined) delete process.env.RIPMAIL_HOME
      else process.env.RIPMAIL_HOME = prevHome
      await rm(script, { force: true })
      await rm(fakeHome, { recursive: true, force: true })
    }
  })

  it('POST /accept-profile copies draft to me.md, writes categories, and transitions to done', async () => {
    const { setOnboardingState, readOnboardingStateDoc, categoriesJsonPath, profileDraftAbsolutePath } =
      await import('../lib/onboardingState.js')
    await mkdir(wikiDirPath(), { recursive: true })
    await writeFile(profileDraftAbsolutePath(), '# Profile\n', 'utf-8')
    await setOnboardingState('indexing')
    await setOnboardingState('profiling')
    await setOnboardingState('reviewing-profile')

    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/accept-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: ['People', 'Projects'] }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; state: string }
    expect(j.ok).toBe(true)
    expect(j.state).toBe('done')
    expect((await readOnboardingStateDoc()).state).toBe('done')
    const me = await import('node:fs/promises').then((fs) => fs.readFile(join(wikiDirPath(), 'me.md'), 'utf-8'))
    expect(me).toContain('Profile')
    const { readFile } = await import('node:fs/promises')
    const catRaw = await readFile(categoriesJsonPath(), 'utf-8')
    expect(catRaw).toContain('People')
    expect(catRaw).toContain('Projects')
  })

  it('POST /accept-profile creates wiki directory if missing (fresh BRAIN_HOME)', async () => {
    const { setOnboardingState, profileDraftAbsolutePath } = await import('../lib/onboardingState.js')
    await mkdir(wikiDirPath(), { recursive: true })
    await writeFile(profileDraftAbsolutePath(), '# Profile\n', 'utf-8')
    await setOnboardingState('indexing')
    await setOnboardingState('profiling')
    await setOnboardingState('reviewing-profile')

    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/accept-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: ['People'] }),
    })
    expect(res.status).toBe(200)
    const me = await import('node:fs/promises').then((fs) => fs.readFile(join(wikiDirPath(), 'me.md'), 'utf-8'))
    expect(me).toContain('Profile')
  })

  describe('GET /network-info tunnel URL vs remoteAccessEnabled', () => {
    afterEach(() => {
      tunnelMocks.getActiveTunnelUrl.mockReset()
      tunnelMocks.getActiveTunnelUrl.mockImplementation((): string | null => null)
      tunnelMocks.stopTunnel.mockClear()
    })

    it('omits tunnelUrl and stops tunnel when remoteAccessEnabled is false', async () => {
      const { onboardingDataDir } = await import('../lib/onboardingState.js')
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
      const j = (await res.json()) as { tunnelUrl: string | null }
      expect(j.tunnelUrl).toBeNull()
      expect(tunnelMocks.stopTunnel).toHaveBeenCalled()
    })

    it('includes tunnelUrl when remoteAccessEnabled is true', async () => {
      const { onboardingDataDir } = await import('../lib/onboardingState.js')
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
      const j = (await res.json()) as { tunnelUrl: string | null }
      expect(j.tunnelUrl).toBe('https://fake.trycloudflare.com/')
      expect(tunnelMocks.stopTunnel).not.toHaveBeenCalled()
    })
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
})
