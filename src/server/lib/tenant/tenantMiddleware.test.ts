import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { tenantMiddleware } from './tenantMiddleware.js'
import { ensureTenantHomeDir, tenantHomeDir } from './dataRoot.js'
import { runWithTenantContextAsync } from './tenantContext.js'
import { mintDeviceToken } from '@server/lib/vault/deviceTokenAuth.js'

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
      const { brainHome } = await import('@server/lib/platform/brainHome.js')
      return c.json({ home: brainHome() })
    })

    const res = await app.request('http://localhost/api/ping')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { home: string }
    expect(j.home).toBe(brainHomeDir)
  })

  it('multi-tenant resolves ingest token to the correct tenant home', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tm-mt-token-'))
    delete process.env.BRAIN_HOME
    process.env.BRAIN_DATA_ROOT = root
    const tenantId = 'usr_aaaaaaaaaaaaaaaaaaaa'
    ensureTenantHomeDir(tenantId)
    const token = await runWithTenantContextAsync(
      { tenantUserId: tenantId, workspaceHandle: tenantId, homeDir: tenantHomeDir(tenantId) },
      async () => (await mintDeviceToken({ label: 'A' })).token,
    )

    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.post('/api/ingest/imessage', async (c) => {
      const { brainHome } = await import('@server/lib/platform/brainHome.js')
      return c.json({ home: brainHome() })
    })
    app.get('/api/not-ingest', async (c) => c.json({ ok: true }))

    const ingestRes = await app.request('http://localhost/api/ingest/imessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(ingestRes.status).toBe(200)
    const ingestJson = (await ingestRes.json()) as { home: string }
    expect(ingestJson.home).toBe(tenantHomeDir(tenantId))

    const notIngest = await app.request('http://localhost/api/not-ingest', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(notIngest.status).toBe(401)

    await rm(root, { recursive: true, force: true })
  })
})
