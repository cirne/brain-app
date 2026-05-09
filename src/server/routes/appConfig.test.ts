import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import appConfigRoute from './appConfig.js'

describe('GET /api/config', () => {
  it('returns ok + app id', async () => {
    const app = new Hono()
    app.route('/api/config', appConfigRoute)
    const res = await app.request('http://localhost/api/config')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok?: boolean; app?: string }
    expect(j.ok).toBe(true)
    expect(j.app).toBe('braintunnel')
  })
})
