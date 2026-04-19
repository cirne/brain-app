import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('../lib/ripmailExec.js', () => ({
  execRipmailAsync: vi.fn(),
}))

import { execRipmailAsync } from '../lib/ripmailExec.js'
import hubRoute from './hub.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'hub-api-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.mocked(execRipmailAsync).mockReset()
})

describe('hub routes', () => {
  it('GET /sources parses ripmail JSON', async () => {
    vi.mocked(execRipmailAsync).mockResolvedValue({
      stdout: JSON.stringify({
        sources: [
          {
            id: 'x_netjets_local',
            kind: 'localDir',
            label: 'NetJets',
            path: '/Users/me/Desktop/NetJets',
          },
          { id: 'a_gmail_com', kind: 'imap', email: 'a@gmail.com' },
        ],
      }),
      stderr: '',
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources')
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      sources: Array<{ id: string; kind: string; displayName: string; path: string | null }>
      error?: string
    }
    expect(j.error).toBeUndefined()
    expect(j.sources).toHaveLength(2)
    expect(j.sources[0]).toMatchObject({
      id: 'x_netjets_local',
      kind: 'localDir',
      displayName: 'NetJets',
      path: '/Users/me/Desktop/NetJets',
    })
    expect(j.sources[1].displayName).toBe('a@gmail.com')
  })

  it('GET /sources returns error payload when ripmail fails', async () => {
    vi.mocked(execRipmailAsync).mockRejectedValue(new Error('ripmail: nope'))
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { sources: unknown[]; error?: string }
    expect(j.sources).toEqual([])
    expect(j.error).toContain('nope')
  })

  it('POST /sources/remove runs ripmail sources remove', async () => {
    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{}', stderr: '' })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x_netjets_local' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean }
    expect(j.ok).toBe(true)
    expect(vi.mocked(execRipmailAsync)).toHaveBeenCalledWith(
      expect.stringContaining('sources remove "x_netjets_local"'),
      expect.any(Object),
    )
  })

  it('POST /sources/remove 400 when id missing', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
