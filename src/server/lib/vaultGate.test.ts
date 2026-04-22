import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import vaultRoute from '../routes/vault.js'
import onboardingRoute from '../routes/onboarding.js'
import { vaultGateMiddleware } from './vaultGate.js'
import { tenantMiddleware } from './tenantMiddleware.js'
import { ensureTenantHomeDir, tenantHomeDir } from './dataRoot.js'
import { registerSessionTenant } from './tenantRegistry.js'
import { createVaultSession } from './vaultSessionStore.js'
import { runWithTenantContextAsync } from './tenantContext.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'vault-gate-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

function buildStack(): Hono {
  const app = new Hono()
  app.use('/api/*', tenantMiddleware)
  app.use('/api/*', vaultGateMiddleware)
  app.route('/api/vault', vaultRoute)
  app.route('/api/onboarding', onboardingRoute)
  return app
}

function cookieFrom(res: Response): string | undefined {
  const raw = res.headers.get('set-cookie') ?? ''
  const m = raw.match(/brain_session=([^;]+)/)
  return m?.[1]
}

describe('vaultGateMiddleware (multi-tenant)', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT

  beforeEach(async () => {
    delete process.env.BRAIN_HOME
  })

  afterEach(async () => {
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
  })

  it('allows onboarding/mail without vault verifier when session maps to tenant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vg-mt-'))
    process.env.BRAIN_DATA_ROOT = root

    const handle = 'gate-mt-h'
    ensureTenantHomeDir(handle)
    const sid = await runWithTenantContextAsync(
      { tenantUserId: handle, workspaceHandle: handle, homeDir: tenantHomeDir(handle) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, handle)

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
})

describe('vaultGateMiddleware', () => {
  it('allows GET /api/onboarding/status when no vault', async () => {
    const app = buildStack()
    const res = await app.request('http://127.0.0.1/api/onboarding/status')
    expect(res.status).toBe(200)
  })

  it('returns 401 for protected route when no vault', async () => {
    const app = buildStack()
    const res = await app.request('http://127.0.0.1/api/onboarding/mail')
    expect(res.status).toBe(401)
    const j = (await res.json()) as { error?: string }
    expect(j.error).toBe('vault_required')
  })

  it('allows full API after setup with session cookie', async () => {
    const app = buildStack()
    const setup = await app.request('http://127.0.0.1/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'vault-pass-1234', confirm: 'vault-pass-1234' }),
    })
    expect(setup.status).toBe(200)
    const sid = cookieFrom(setup)!
    const mail = await app.request('http://127.0.0.1/api/onboarding/mail', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(mail.status).toBe(200)
  })

  it('returns unlock_required when vault exists but no cookie', async () => {
    const app = buildStack()
    await app.request('http://127.0.0.1/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'vault-pass-1234', confirm: 'vault-pass-1234' }),
    })
    const app2 = buildStack()
    const res = await app2.request('http://127.0.0.1/api/onboarding/mail')
    expect(res.status).toBe(401)
    const j = (await res.json()) as { error?: string }
    expect(j.error).toBe('unlock_required')
  })

  it('applies gate when NODE_ENV is development (no dev bypass)', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const app = buildStack()
      const res = await app.request('http://127.0.0.1/api/onboarding/mail')
      expect(res.status).toBe(401)
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})
