import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import onboardingRoute from '../../routes/onboarding.js'
import { vaultGateMiddleware } from './vaultGate.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from './vaultSessionStore.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import issuesRoute from '../../routes/issues.js'
import { mintDeviceToken } from './deviceTokenAuth.js'

const TENANT_A = 'usr_enrondemo00000000001'

describe('vaultGateMiddleware', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT

  beforeEach(() => {
    delete process.env.BRAIN_HOME
  })

  afterEach(async () => {
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
  })

  it('allows onboarding/mail without vault verifier when session maps to tenant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vg-mt-'))
    process.env.BRAIN_DATA_ROOT = root

    ensureTenantHomeDir(TENANT_A)
    const sid = await runWithTenantContextAsync(
      { tenantUserId: TENANT_A, workspaceHandle: TENANT_A, homeDir: tenantHomeDir(TENANT_A) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, TENANT_A)

    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.use('/api/*', vaultGateMiddleware)
    app.route('/api/onboarding', onboardingRoute)

    const res = await app.request('http://127.0.0.1/api/onboarding/mail', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(res.status).toBe(200)

    await rm(root, { recursive: true, force: true })
  })

  it('returns tenant_required without session cookie', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vg-mt-no-'))
    process.env.BRAIN_DATA_ROOT = root

    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.use('/api/*', vaultGateMiddleware)
    app.route('/api/onboarding', onboardingRoute)

    const res = await app.request('http://127.0.0.1/api/onboarding/mail')
    expect(res.status).toBe(401)
    const j = (await res.json()) as { error?: string }
    expect(j.error).toBe('tenant_required')

    await rm(root, { recursive: true, force: true })
  })

  it('allows GET /api/issues with embed key and no session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vg-embed-'))
    const prev = process.env.BRAIN_DATA_ROOT
    const prevK = process.env.BRAIN_EMBED_MASTER_KEY
    process.env.BRAIN_DATA_ROOT = root
    process.env.BRAIN_EMBED_MASTER_KEY = 'test-embed-issues-key'

    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.use('/api/*', vaultGateMiddleware)
    app.route('/api/issues', issuesRoute)

    const res = await app.request('http://127.0.0.1/api/issues', {
      headers: { Authorization: 'Bearer test-embed-issues-key' },
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { issues: unknown[] }
    expect(j.issues).toEqual([])

    if (prev === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prev
    if (prevK === undefined) delete process.env.BRAIN_EMBED_MASTER_KEY
    else process.env.BRAIN_EMBED_MASTER_KEY = prevK
    await rm(root, { recursive: true, force: true })
  })

  it('allows only ingest endpoints with valid device token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vg-devtok-'))
    process.env.BRAIN_DATA_ROOT = root

    const tid = 'usr_devtokentest00000001'
    ensureTenantHomeDir(tid)
    const homeDir = tenantHomeDir(tid)
    const minted = await mintDeviceToken({ label: 'Operator Mac', homeDir })

    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.use('/api/*', vaultGateMiddleware)
    app.post('/api/ingest/imessage', (c) => c.json({ ok: true }))
    app.get('/api/ingest/imessage/cursor', (c) => c.json({ ok: true }))
    app.get('/api/other', (c) => c.json({ ok: true }))

    const okIngest = await app.request('http://127.0.0.1/api/ingest/imessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${minted.token}` },
    })
    expect(okIngest.status).toBe(200)

    const okCursor = await app.request('http://127.0.0.1/api/ingest/imessage/cursor', {
      headers: { Authorization: `Bearer ${minted.token}` },
    })
    expect(okCursor.status).toBe(200)

    const blockedOther = await app.request('http://127.0.0.1/api/other', {
      headers: { Authorization: `Bearer ${minted.token}` },
    })
    expect(blockedOther.status).toBe(401)

    await rm(root, { recursive: true, force: true })
  })
})
