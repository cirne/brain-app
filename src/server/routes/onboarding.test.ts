import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import onboardingRoute from './onboarding.js'

let chatDir: string
let wikiDirPath: string

beforeEach(async () => {
  chatDir = await mkdtemp(join(tmpdir(), 'onboarding-api-'))
  wikiDirPath = await mkdtemp(join(tmpdir(), 'onboarding-wiki-'))
  process.env.CHAT_DATA_DIR = chatDir
  process.env.WIKI_DIR = wikiDirPath
})

afterEach(async () => {
  await rm(chatDir, { recursive: true, force: true })
  await rm(wikiDirPath, { recursive: true, force: true })
  delete process.env.CHAT_DATA_DIR
  delete process.env.WIKI_DIR
})

describe('onboarding routes', () => {
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

  it('GET /profile-draft returns 404 when no draft exists', async () => {
    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/profile-draft')
    expect(res.status).toBe(404)
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

  it('POST /accept-profile copies draft to me.md when state is reviewing-profile', async () => {
    const { setOnboardingState } = await import('../lib/onboardingState.js')
    const { profileDraftAbsolutePath } = await import('../lib/onboardingState.js')
    await mkdir(join(chatDir, 'onboarding'), { recursive: true })
    await writeFile(profileDraftAbsolutePath(), '# Profile\n', 'utf-8')
    await setOnboardingState('indexing')
    await setOnboardingState('profiling')
    await setOnboardingState('reviewing-profile')

    const app = new Hono()
    app.route('/api/onboarding', onboardingRoute)
    const res = await app.request('http://localhost/api/onboarding/accept-profile', { method: 'POST' })
    expect(res.status).toBe(200)
    const me = await import('node:fs/promises').then((fs) => fs.readFile(join(wikiDirPath, 'me.md'), 'utf-8'))
    expect(me).toContain('Profile')
  })
})
