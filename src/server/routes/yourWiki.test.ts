import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BackgroundRunDoc } from '../lib/backgroundAgentStore.js'

vi.mock('../agent/yourWikiSupervisor.js', () => ({
  ensureYourWikiRunning: vi.fn().mockResolvedValue(undefined),
  pauseYourWiki: vi.fn().mockResolvedValue(undefined),
  resumeYourWiki: vi.fn().mockResolvedValue(undefined),
  requestLapNow: vi.fn(),
  getYourWikiDoc: vi.fn().mockResolvedValue({
    id: 'your-wiki',
    kind: 'your-wiki',
    status: 'running',
    label: 'Your Wiki',
    detail: 'Enriching…',
    pageCount: 10,
    logLines: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    phase: 'enriching',
    lap: 2,
    consecutiveNoOpLaps: 0,
  } as BackgroundRunDoc),
}))

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'your-wiki-routes-test-'))
  process.env.BRAIN_HOME = brainHome
  await mkdir(join(brainHome, 'background', 'runs'), { recursive: true })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.clearAllMocks()
})

async function makeApp() {
  const { default: yourWikiRoute } = await import('./yourWiki.js')
  const app = new Hono()
  app.route('/api/your-wiki', yourWikiRoute)
  return app
}

describe('GET /api/your-wiki', () => {
  it('returns the supervisor doc', async () => {
    const app = await makeApp()
    const res = await app.request('http://localhost/api/your-wiki')
    expect(res.status).toBe(200)
    const j = (await res.json()) as BackgroundRunDoc
    expect(j.id).toBe('your-wiki')
    expect(j.phase).toBe('enriching')
    expect(j.lap).toBe(2)
  })
})

describe('POST /api/your-wiki/pause', () => {
  it('calls pauseYourWiki and returns ok', async () => {
    const app = await makeApp()
    const { pauseYourWiki } = await import('../agent/yourWikiSupervisor.js')
    const res = await app.request('http://localhost/api/your-wiki/pause', { method: 'POST' })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean }
    expect(j.ok).toBe(true)
    expect(pauseYourWiki).toHaveBeenCalledOnce()
  })
})

describe('POST /api/your-wiki/resume', () => {
  it('calls resumeYourWiki and returns ok', async () => {
    const app = await makeApp()
    const { resumeYourWiki } = await import('../agent/yourWikiSupervisor.js')
    const res = await app.request('http://localhost/api/your-wiki/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: 'America/Los_Angeles' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean }
    expect(j.ok).toBe(true)
    expect(resumeYourWiki).toHaveBeenCalledWith({ timezone: 'America/Los_Angeles' })
  })
})

describe('POST /api/your-wiki/run-lap', () => {
  it('calls requestLapNow and returns ok', async () => {
    const app = await makeApp()
    const { requestLapNow } = await import('../agent/yourWikiSupervisor.js')
    const res = await app.request('http://localhost/api/your-wiki/run-lap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean }
    expect(j.ok).toBe(true)
    expect(requestLapNow).toHaveBeenCalledOnce()
  })
})
