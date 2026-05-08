import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import vaultRoute from './vault.js'
import { B2B_ENABLED } from '@server/lib/features.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { registerIdentityWorkspace, registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'

const prevRoot = process.env.BRAIN_DATA_ROOT

beforeEach(() => {
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

describe('/api/vault routes', () => {
  it('GET /status without session returns multiTenant true and unlocked false', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-mt-st-'))
    process.env.BRAIN_DATA_ROOT = root

    const app = mountMtVault()
    const st = await app.request('http://localhost/api/vault/status')
    expect(st.status).toBe(200)
    const j = (await st.json()) as { multiTenant?: boolean; unlocked: boolean; brainQueryEnabled?: boolean }
    expect(j.multiTenant).toBe(true)
    expect(j.unlocked).toBe(false)
    expect(j.brainQueryEnabled).toBe(B2B_ENABLED)

    await rm(root, { recursive: true, force: true })
  })

  it('GET /status with session returns unlocked true', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-mt-status-sess-'))
    process.env.BRAIN_DATA_ROOT = root

    const handle = 'usr_testvault00000000001'
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
      unlocked: boolean
      workspaceHandle?: string
      brainQueryEnabled?: boolean
    }
    expect(j.multiTenant).toBe(true)
    expect(j.unlocked).toBe(true)
    expect(j.workspaceHandle).toBe(handle)
    expect(j.brainQueryEnabled).toBe(B2B_ENABLED)

    await rm(root, { recursive: true, force: true })
  })

  it('POST /logout clears session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-mt-logout-'))
    process.env.BRAIN_DATA_ROOT = root

    const handle = 'usr_testvault00000000002'
    ensureTenantHomeDir(handle)
    const sid = await runWithTenantContextAsync(
      { tenantUserId: handle, workspaceHandle: handle, homeDir: tenantHomeDir(handle) },
      async () => createVaultSession(),
    )
    await registerSessionTenant(sid, handle)

    const app = mountMtVault()
    const out = await app.request('http://localhost/api/vault/logout', {
      method: 'POST',
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(out.status).toBe(200)
    const st = await app.request('http://localhost/api/vault/status')
    const j = (await st.json()) as { unlocked: boolean }
    expect(j.unlocked).toBe(false)

    await rm(root, { recursive: true, force: true })
  })

  it('POST /delete-all-data removes tenant dir, identity map, and session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vault-mt-del-'))
    process.env.BRAIN_DATA_ROOT = root

    const handle = 'usr_testvault00000000003'
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
    const body = (await del.json()) as { ok?: boolean; unlocked?: boolean; brainQueryEnabled?: boolean }
    expect(body.ok).toBe(true)
    expect(body.unlocked).toBe(false)
    expect(body.brainQueryEnabled).toBe(B2B_ENABLED)

    expect(existsSync(home)).toBe(false)

    const { lookupWorkspaceByIdentity } = await import('@server/lib/tenant/tenantRegistry.js')
    expect(await lookupWorkspaceByIdentity('google:test-sub-delete')).toBeNull()

    const st = await app.request('http://localhost/api/vault/status')
    const j = (await st.json()) as { unlocked: boolean }
    expect(j.unlocked).toBe(false)

    await rm(root, { recursive: true, force: true })
  })
})
