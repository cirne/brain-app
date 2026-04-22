import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runWithTenantContextAsync } from '../lib/tenantContext.js'
import navRecentsRoute from './navRecents.js'

describe('GET/POST/DELETE /api/nav/recents', () => {
  let home: string
  let app: Hono

  beforeEach(() => {
    home = join(tmpdir(), `nrrt-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    app = new Hono()
    app.use('/api/*', async (c, next) => {
      return runWithTenantContextAsync({ tenantUserId: 't1', workspaceHandle: 't1', homeDir: home }, () =>
        next(),
      )
    })
    app.route('/api/nav/recents', navRecentsRoute)
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('GET returns array; POST appends; DELETE by id', async () => {
    const g0 = await app.request('http://localhost/api/nav/recents')
    expect(g0.status).toBe(200)
    expect(await g0.json()).toEqual([])

    const p = await app.request('http://localhost/api/nav/recents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'doc:test.md',
        type: 'doc',
        title: 'test.md',
        path: 'test.md',
      }),
    })
    expect(p.status).toBe(200)

    const g1 = await app.request('http://localhost/api/nav/recents')
    expect(g1.status).toBe(200)
    const arr = (await g1.json()) as { id: string }[]
    expect(arr.some((x) => x.id === 'doc:test.md')).toBe(true)

    const d = await app.request(
      `http://localhost/api/nav/recents?id=${encodeURIComponent('doc:test.md')}`,
      { method: 'DELETE' },
    )
    expect(d.status).toBe(200)

    const g2 = await app.request('http://localhost/api/nav/recents')
    expect(await g2.json()).toEqual([])
  })

  it('POST upsert-email returns updated flag', async () => {
    const res = await app.request('http://localhost/api/nav/recents/upsert-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: 'thr1', subject: 'Hi', from: 'x@y.z' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { updated?: boolean }
    expect(j.updated).toBe(true)

    const res2 = await app.request('http://localhost/api/nav/recents/upsert-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: 'thr1', subject: 'Hi', from: 'x@y.z' }),
    })
    const j2 = (await res2.json()) as { updated?: boolean }
    expect(j2.updated).toBe(false)
  })

  it('DELETE ?all=1 clears', async () => {
    await app.request('http://localhost/api/nav/recents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'doc:a', type: 'doc', title: 'a', path: 'a' }),
    })
    const cl = await app.request('http://localhost/api/nav/recents?all=1', { method: 'DELETE' })
    expect(cl.status).toBe(200)
    const g = await app.request('http://localhost/api/nav/recents')
    expect(await g.json()).toEqual([])
  })
})
