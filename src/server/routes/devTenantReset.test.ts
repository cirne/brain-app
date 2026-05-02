import { describe, it, expect, afterEach } from 'vitest'
import { Hono } from 'hono'
import { registerDevTenantResetRoutes } from './devTenantReset.js'

describe('devTenantReset routes', () => {
  const prevEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = prevEnv
  })

  it('POST /reset returns 404 when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production'
    const app = new Hono()
    registerDevTenantResetRoutes(app)
    const res = await app.request('http://localhost/reset', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('POST /hard-reset returns 404 when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production'
    const app = new Hono()
    registerDevTenantResetRoutes(app)
    const res = await app.request('http://localhost/hard-reset', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('POST /reset returns 401 without session when not production', async () => {
    process.env.NODE_ENV = 'development'
    const app = new Hono()
    registerDevTenantResetRoutes(app)
    const res = await app.request('http://localhost/reset', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('GET /reset returns 404 when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production'
    const app = new Hono()
    registerDevTenantResetRoutes(app)
    const res = await app.request('http://localhost/reset', { method: 'GET' })
    expect(res.status).toBe(404)
  })

  it('GET /reset returns 401 without session when not production', async () => {
    process.env.NODE_ENV = 'development'
    const app = new Hono()
    registerDevTenantResetRoutes(app)
    const res = await app.request('http://localhost/reset', { method: 'GET' })
    expect(res.status).toBe(401)
  })
})
