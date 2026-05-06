import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeBrainGlobalDbForTests, getBrainGlobalDb } from '@server/lib/global/brainGlobalDb.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { BRAIN_SESSION_COOKIE } from '@server/lib/vault/vaultCookie.js'
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

  describe('POST /hard-reset with session', () => {
    let dataRoot: string
    let prevDataRoot: string | undefined

    beforeEach(async () => {
      closeBrainGlobalDbForTests()
      prevDataRoot = process.env.BRAIN_DATA_ROOT
      dataRoot = await mkdtemp(join(tmpdir(), 'dev-hard-reset-'))
      process.env.BRAIN_DATA_ROOT = dataRoot
      delete process.env.BRAIN_HOME
    })

    afterEach(async () => {
      closeBrainGlobalDbForTests()
      if (prevDataRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevDataRoot
      else delete process.env.BRAIN_DATA_ROOT
      await rm(dataRoot, { recursive: true, force: true })
    })

    it('leaves BRAIN_DATA_ROOT empty (no usr_* dirs) so the next sign-in creates a single tenant', async () => {
      process.env.NODE_ENV = 'development'
      const tenantUserId = 'usr_hh111111111111111111'
      ensureTenantHomeDir(tenantUserId)
      await writeHandleMeta(tenantHomeDir(tenantUserId), {
        userId: tenantUserId,
        handle: 'testhandle',
        confirmedAt: null,
      })
      getBrainGlobalDb()

      const sessionId = await runWithTenantContextAsync(
        {
          tenantUserId,
          workspaceHandle: 'testhandle',
          homeDir: tenantHomeDir(tenantUserId),
        },
        async () => createVaultSession(),
      )
      await registerSessionTenant(sessionId, tenantUserId)

      const app = new Hono()
      registerDevTenantResetRoutes(app)
      const res = await app.request('http://localhost/hard-reset', {
        method: 'POST',
        headers: { cookie: `${BRAIN_SESSION_COOKIE}=${sessionId}` },
      })

      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok?: boolean }
      expect(body.ok).toBe(true)

      closeBrainGlobalDbForTests()
      const top = await readdir(dataRoot)
      expect(top.filter((n) => n.startsWith('usr_'))).toEqual([])
      expect(top).toEqual([])
    })
  })
})
