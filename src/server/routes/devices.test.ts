import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import vaultRoute from './vault.js'
import devicesRoute from './devices.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'devices-route-'))
  process.env.BRAIN_HOME = brainHome
  delete process.env.BRAIN_DATA_ROOT
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

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
    const setup = await app.request('http://localhost/api/vault/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'good-pass-phrase', confirm: 'good-pass-phrase' }),
    })
    expect(setup.status).toBe(200)
    const sid = sessionFromResponse(setup)
    expect(sid).toBeTruthy()

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
