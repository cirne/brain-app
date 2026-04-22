import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BackgroundRunDoc } from '../lib/backgroundAgentStore.js'

vi.mock('../agent/yourWikiSupervisor.js', () => ({
  getYourWikiDoc: vi.fn().mockResolvedValue({
    id: 'your-wiki',
    kind: 'your-wiki',
    status: 'completed',
    label: 'Your Wiki',
    detail: '',
    pageCount: 0,
    logLines: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    timeline: [],
    phase: 'idle',
    lap: 1,
    consecutiveNoOpLaps: 0,
  } satisfies BackgroundRunDoc),
}))

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'hub-events-api-'))
  process.env.BRAIN_HOME = brainHome
  await mkdir(join(brainHome, 'background', 'runs'), { recursive: true })
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.clearAllMocks()
})

describe('GET /api/events', () => {
  it('returns event-stream with snapshot events', async () => {
    const { default: hubEventsRoute } = await import('./hubEvents.js')
    const app = new Hono()
    app.route('/api/events', hubEventsRoute)

    const res = await app.request('http://localhost/api/events')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')?.includes('text/event-stream')).toBe(true)

    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let acc = ''
    for (let i = 0; i < 20 && !acc.includes('background_agents'); i++) {
      const { done, value } = await reader.read()
      if (done) break
      acc += dec.decode(value, { stream: true })
    }
    await reader.cancel()

    expect(acc).toContain('event: your_wiki')
    expect(acc).toContain('event: background_agents')
  })
})
