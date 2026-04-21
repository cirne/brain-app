import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { tenantMiddleware } from './tenantMiddleware.js'

describe('tenantMiddleware', () => {
  let brainHomeDir: string
  const prevRoot = process.env.BRAIN_DATA_ROOT

  beforeEach(async () => {
    brainHomeDir = await mkdtemp(join(tmpdir(), 'tm-st-'))
    delete process.env.BRAIN_DATA_ROOT
    process.env.BRAIN_HOME = brainHomeDir
  })

  afterEach(async () => {
    await rm(brainHomeDir, { recursive: true, force: true })
    delete process.env.BRAIN_HOME
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
  })

  it('single-tenant wraps requests so brainHome resolves', async () => {
    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.get('/api/ping', async (c) => {
      const { brainHome } = await import('./brainHome.js')
      return c.json({ home: brainHome() })
    })

    const res = await app.request('http://localhost/api/ping')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { home: string }
    expect(j.home).toBe(brainHomeDir)
  })
})
