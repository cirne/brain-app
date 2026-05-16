import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'

describe('registerApiRoutes', () => {
  // Dynamic import of the full route graph can exceed the default 5s under parallel CI load.
  const routeImportTimeout = 15_000

  afterEach(() => {
    vi.resetModules()
  })

  it(
    'mounts /api/brain-query and /api/chat/b2b',
    async () => {
      vi.resetModules()
      const { registerApiRoutes: registerFresh } = await import('./registerApiRoutes.js')
      const app = new Hono()
      registerFresh(app, { isDev: false })
      const grants = await app.request('http://localhost/api/brain-query/grants')
      expect(grants.status).not.toBe(404)
      const b2b = await app.request('http://localhost/api/chat/b2b/tunnels')
      expect(b2b.status).not.toBe(404)
    },
    routeImportTimeout,
  )
})
