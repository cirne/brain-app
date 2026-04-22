import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import vaultRoute from './vault.js'
import { tenantMiddleware } from '../lib/tenantMiddleware.js'
import { vaultGateMiddleware } from '../lib/vaultGate.js'
import { ensureTenantHomeDir, tenantHomeDir } from '../lib/dataRoot.js'
import { registerIdentityWorkspace, registerSessionTenant } from '../lib/tenantRegistry.js'
import { writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createVaultSession } from '../lib/vaultSessionStore.js'
import { runWithTenantContextAsync } from '../lib/tenantContext.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'vault-route-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

function mountVault(): Hono {
  const app = new Hono()
  app.route('/api/vault', vaultRoute)
  return app
}

function sessionFromResponse(res: Response): string | undefined {
  const list =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? '']
  for (const raw of list) {
    const m = raw.match(/brain_session=([^;]+)/)
    if (m?.[1]) return m[1].trim()
  }
  return undefined
}

describe('/api/vault routes', () => {
  it('GET /status returns vaultExists false initially', async () => {
    const app = mountVault()
    const res = await app.request('http://localhost/api/vault/status')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { vaultExists: boolean; unlocked: boolean; multiTenant?: boolean }
    expect(j.vaultExists).toBe(false)
    expect(j.unlocked).toBe(false)
    expect(j.multiTenant).toBeFalsy()
  })

  it('POST /setup creates vault and sets session cookie', async () => {
    const app = mountVault()
    const res = await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'good-pass-phrase', confirm: 'good-pass-phrase' }),
    })
    expect(res.status).toBe(200)
    const sid = sessionFromResponse(res)
    expect(sid).toBeTruthy()
    const j = (await res.json()) as { ok: boolean; vaultExists: boolean; unlocked: boolean }
    expect(j.ok).toBe(true)
    expect(j.vaultExists).toBe(true)
    expect(j.unlocked).toBe(true)
  })

  it('POST /setup rejects mismatch', async () => {
    const app = mountVault()
    const res = await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'aaaaaaaa', confirm: 'bbbbbbbb' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /unlock rejects wrong password', async () => {
    const app = mountVault()
    await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-pass-here', confirm: 'correct-pass-here' }),
    })
    const res = await app.request('http://localhost/api/vault/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-pass-here' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /unlock accepts correct password', async () => {
    const app = mountVault()
    await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-pass-here', confirm: 'correct-pass-here' }),
    })
    const res = await app.request('http://localhost/api/vault/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-pass-here' }),
    })
    expect(res.status).toBe(200)
    expect(sessionFromResponse(res)).toBeTruthy()
  })

  it('POST /logout clears session', async () => {
    const app = mountVault()
    const setupRes = await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-pass-here', confirm: 'correct-pass-here' }),
    })
    const sid = sessionFromResponse(setupRes)!
    const out = await app.request('http://localhost/api/vault/logout', {
      method: 'POST',
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(out.status).toBe(200)
    const st = await app.request('http://localhost/api/vault/status')
    const j = (await st.json()) as { unlocked: boolean }
    expect(j.unlocked).toBe(false)
  })

  it('POST /delete-all-data returns 404 when not multi-tenant', async () => {
    const app = mountVault()
    const del = await app.request('http://localhost/api/vault/delete-all-data', { method: 'POST' })
    expect(del.status).toBe(404)
  })
})

describe('/api/vault routes (multi-tenant)', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT

  beforeEach(async () => {
    delete process.env.BRAIN_HOME
  })

  afterEach(async () => {
    delete process.env.BRAIN_DATA_ROOT
    if (prevRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevRoot
  })

  function mountMtVault(): Hono {
    const app = new Hono()
    app.use('/api/*', tenantMiddleware)
    app.use('/api/*', vaultGateMiddleware)
    app.route('/api/vault', vaultRoute)
    return app
  }

  it('POST /setup returns 405', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-mt-setup-405-'))
    process.env.BRAIN_DATA_ROOT = root

    const app = mountMtVault()
    const res = await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'good-pass-phrase', confirm: 'good-pass-phrase' }),
    })
    expect(res.status).toBe(405)

    await rm(root, { recursive: true, force: true })
  })

  it('POST /unlock returns 405', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-mt-unlock-405-'))
    process.env.BRAIN_DATA_ROOT = root

    const app = mountMtVault()
    const res = await app.request('http://localhost/api/vault/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'x' }),
    })
    expect(res.status).toBe(405)

    await rm(root, { recursive: true, force: true })
  })

  it('GET /status without session returns multiTenant true and vaultExists false when empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-mt-st-'))
    process.env.BRAIN_DATA_ROOT = root

    const app = mountMtVault()
    const st = await app.request('http://localhost/api/vault/status')
    expect(st.status).toBe(200)
    const j = (await st.json()) as { multiTenant?: boolean; vaultExists: boolean; unlocked: boolean }
    expect(j.multiTenant).toBe(true)
    expect(j.vaultExists).toBe(false)
    expect(j.unlocked).toBe(false)

    await rm(root, { recursive: true, force: true })
  })

  it('GET /status with session returns unlocked true without vault verifier', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-mt-status-sess-'))
    process.env.BRAIN_DATA_ROOT = root

    const handle = 'sess-ws-handle'
    ensureTenantHomeDir(handle)
    const sid = await runWithTenantContextAsync(
      { tenantUserId: handle, workspaceHandle: handle, homeDir: tenantHomeDir(handle) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, handle)

    const app = mountMtVault()
    const st = await app.request('http://localhost/api/vault/status', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(st.status).toBe(200)
    const j = (await st.json()) as {
      multiTenant?: boolean
      vaultExists: boolean
      unlocked: boolean
      workspaceHandle?: string
    }
    expect(j.multiTenant).toBe(true)
    expect(j.vaultExists).toBe(true)
    expect(j.unlocked).toBe(true)
    expect(j.workspaceHandle).toBe(handle)

    await rm(root, { recursive: true, force: true })
  })

  it('POST /delete-all-data removes tenant dir, identity map, and session (multi-tenant)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-mt-del-'))
    process.env.BRAIN_DATA_ROOT = root

    const handle = 'del-ws-handle'
    const home = ensureTenantHomeDir(handle)
    await writeFile(join(home, 'marker.txt'), 'x', 'utf-8')
    const sid = await runWithTenantContextAsync(
      { tenantUserId: handle, workspaceHandle: handle, homeDir: tenantHomeDir(handle) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, handle)
    await registerIdentityWorkspace('google:test-sub-delete', handle)

    const app = mountMtVault()
    const del = await app.request('http://localhost/api/vault/delete-all-data', {
      method: 'POST',
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(del.status).toBe(200)
    const body = (await del.json()) as { ok?: boolean; unlocked?: boolean }
    expect(body.ok).toBe(true)
    expect(body.unlocked).toBe(false)

    expect(existsSync(home)).toBe(false)

    const { lookupWorkspaceByIdentity } = await import('../lib/tenantRegistry.js')
    expect(await lookupWorkspaceByIdentity('google:test-sub-delete')).toBeNull()

    const st = await app.request('http://localhost/api/vault/status')
    const j = (await st.json()) as { unlocked: boolean }
    expect(j.unlocked).toBe(false)

    await rm(root, { recursive: true, force: true })
  })
})
