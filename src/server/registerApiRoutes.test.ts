import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'

describe('registerApiRoutes', () => {
  // Dynamic import of the full route graph can exceed the default 5s under parallel CI load.
  const routeImportTimeout = 15_000
  const prevB2b = process.env.BRAIN_B2B_ENABLED

  afterEach(() => {
    vi.resetModules()
    if (prevB2b === undefined) delete process.env.BRAIN_B2B_ENABLED
    else process.env.BRAIN_B2B_ENABLED = prevB2b
  })

  it(
    'does not mount /api/brain-query when BRAIN_B2B_ENABLED is unset',
    async () => {
      delete process.env.BRAIN_B2B_ENABLED
      vi.resetModules()
      const { registerApiRoutes: registerFresh } = await import('./registerApiRoutes.js')
      const app = new Hono()
      registerFresh(app, { isDev: false })
      const res = await app.request('http://localhost/api/brain-query/grants')
      expect(res.status).toBe(404)
    },
    routeImportTimeout,
  )

  it(
    'does not mount /api/brain-query when BRAIN_B2B_ENABLED=0',
    async () => {
      process.env.BRAIN_B2B_ENABLED = '0'
      vi.resetModules()
      const { registerApiRoutes: registerFresh } = await import('./registerApiRoutes.js')
      const app = new Hono()
      registerFresh(app, { isDev: false })
      const res = await app.request('http://localhost/api/brain-query/grants')
      expect(res.status).toBe(404)
    },
    routeImportTimeout,
  )
})
