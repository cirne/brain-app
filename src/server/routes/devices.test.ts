import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import vaultRoute from './vault.js'
import devicesRoute from './devices.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { generateUserId } from '@server/lib/tenant/handleMeta.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'

let dataRoot: string
let prevDataRoot: string | undefined

beforeEach(async () => {
  dataRoot = await mkdtemp(join(tmpdir(), 'devices-route-'))
  prevDataRoot = process.env.BRAIN_DATA_ROOT
  process.env.BRAIN_DATA_ROOT = dataRoot
  delete process.env.BRAIN_HOME
})

afterEach(async () => {
  await rm(dataRoot, { recursive: true, force: true })
  if (prevDataRoot === undefined) delete process.env.BRAIN_DATA_ROOT
  else process.env.BRAIN_DATA_ROOT = prevDataRoot
})

async function mintSessionCookie(): Promise<string> {
  const uid = generateUserId()
  ensureTenantHomeDir(uid)
  const home = tenantHomeDir(uid)
  return runWithTenantContextAsync({ tenantUserId: uid, workspaceHandle: uid, homeDir: home }, async () => {
    const sid = await createVaultSession()
    await registerSessionTenant(sid, uid)
    return sid
  })
}

function mountApp(): Hono {
  const app = new Hono()
  app.use('/api/*', tenantMiddleware)
  app.use('/api/*', vaultGateMiddleware)
  app.route('/api/vault', vaultRoute)
  app.route('/api/devices', devicesRoute)
  return app
}

describe('/api/devices', () => {
  it('requires vault session', async () => {
    const app = mountApp()
    const res = await app.request('http://localhost/api/devices')
    expect(res.status).toBe(401)
  })

  it('mints, lists, and revokes devices', async () => {
    const app = mountApp()
    const sid = await mintSessionCookie()

    const create = await app.request('http://localhost/api/devices', {
      method: 'POST',
      headers: {
        Cookie: `brain_session=${sid}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'Operator Mac' }),
    })
    expect(create.status).toBe(200)
    const created = (await create.json()) as {
      ok: boolean
      token: string
      device: { id: string; label: string }
    }
    expect(created.ok).toBe(true)
    expect(created.token.startsWith('brn_dev_')).toBe(true)
    expect(created.device.label).toBe('Operator Mac')

    const list = await app.request('http://localhost/api/devices', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(list.status).toBe(200)
    const listed = (await list.json()) as { devices: Array<{ id: string; label: string }> }
    expect(listed.devices).toHaveLength(1)
    expect(listed.devices[0]?.id).toBe(created.device.id)

    const del = await app.request(`http://localhost/api/devices/${created.device.id}`, {
      method: 'DELETE',
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(del.status).toBe(200)
    const listAfter = await app.request('http://localhost/api/devices', {
      headers: { Cookie: `brain_session=${sid}` },
    })
    const after = (await listAfter.json()) as { devices: unknown[] }
    expect(after.devices).toHaveLength(0)
  })
})
