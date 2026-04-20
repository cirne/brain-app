import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import backgroundRoute from './background.js'

vi.mock('../agent/wikiExpansionRunner.js', () => ({
  pauseWikiExpansionRun: vi.fn(),
  resumeWikiExpansionRun: vi.fn(),
}))

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'bg-api-'))
  process.env.BRAIN_HOME = brainHome
  await mkdir(join(brainHome, 'chats'), { recursive: true })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('background routes', () => {
  it('GET /agents returns list', async () => {
    const app = new Hono()
    app.route('/api/background', backgroundRoute)
    const res = await app.request('http://localhost/api/background/agents')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { agents: unknown[] }
    expect(Array.isArray(j.agents)).toBe(true)
  })

  it('GET /agents/:id returns 404 when missing', async () => {
    const app = new Hono()
    app.route('/api/background', backgroundRoute)
    const res = await app.request('http://localhost/api/background/agents/not-a-real-id')
    expect(res.status).toBe(404)
  })

  it('GET /agents/:id returns run doc', async () => {
    const id = 'test-run-1'
    await mkdir(join(brainHome, 'background', 'runs'), { recursive: true })
    await writeFile(
      join(brainHome, 'background', 'runs', `${id}.json`),
      JSON.stringify({
        id,
        kind: 'wiki-expansion',
        status: 'completed',
        label: 'Building wiki',
        detail: 'Done',
        pageCount: 0,
        lastWikiPath: null,
        logLines: [],
        logEntries: [],
        timeline: [],
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      'utf-8',
    )
    const app = new Hono()
    app.route('/api/background', backgroundRoute)
    const res = await app.request(`http://localhost/api/background/agents/${id}`)
    expect(res.status).toBe(200)
    const j = (await res.json()) as { id: string; status: string }
    expect(j.id).toBe(id)
    expect(j.status).toBe('completed')
  })

  it('GET /agents returns list (may include your-wiki doc)', async () => {
    const app = new Hono()
    app.route('/api/background', backgroundRoute)
    const res = await app.request('http://localhost/api/background/agents')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { agents: unknown[] }
    expect(Array.isArray(j.agents)).toBe(true)
  })
})
