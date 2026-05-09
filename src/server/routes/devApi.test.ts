import { describe, it, expect, afterEach } from 'vitest'
import { Hono } from 'hono'
import { registerApiRoutes } from '../registerApiRoutes.js'

describe('GET /api/dev/soft-reset', () => {
  const prevEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = prevEnv
  })

  it('returns 401 without session when dev routes are mounted', async () => {
    process.env.NODE_ENV = 'development'
    const app = new Hono()
    registerApiRoutes(app, { isDev: true })
    const res = await app.request('http://localhost/api/dev/soft-reset', { method: 'GET' })
    expect(res.status).toBe(401)
  })

  it('is not mounted when registerApiRoutes isDev is false', async () => {
    process.env.NODE_ENV = 'development'
    const app = new Hono()
    registerApiRoutes(app, { isDev: false })
    const res = await app.request('http://localhost/api/dev/soft-reset', { method: 'GET' })
    expect(res.status).toBe(404)
  })
})
