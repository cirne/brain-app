import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import vaultRoute from './vault.js'
import devicesRoute from './devices.js'
import ingestRoute from './ingest.js'
import { searchImessageMessages } from '@server/lib/messages/messagesDb.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { mintDeviceToken } from '@server/lib/vault/deviceTokenAuth.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { generateUserId } from '@server/lib/tenant/handleMeta.js'

let root: string
let prevBrainHome: string | undefined
let prevDataRoot: string | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ingest-route-'))
  prevBrainHome = process.env.BRAIN_HOME
  prevDataRoot = process.env.BRAIN_DATA_ROOT
  delete process.env.BRAIN_HOME
  process.env.BRAIN_DATA_ROOT = root
})

afterEach(async () => {
  if (prevBrainHome == null) delete process.env.BRAIN_HOME
  else process.env.BRAIN_HOME = prevBrainHome
  if (prevDataRoot == null) delete process.env.BRAIN_DATA_ROOT
  else process.env.BRAIN_DATA_ROOT = prevDataRoot
  await rm(root, { recursive: true, force: true })
})

async function mintTenantSessionAndDeviceToken(uid: string): Promise<{ sid: string; token: string }> {
  ensureTenantHomeDir(uid)
  const home = tenantHomeDir(uid)
  const sid = await runWithTenantContextAsync(
    { tenantUserId: uid, workspaceHandle: uid, homeDir: home },
    async () => createVaultSession(),
  )
  await registerSessionTenant(sid, uid)
  const { token } = await mintDeviceToken({ label: 'Mac', homeDir: home })
  return { sid, token }
}

function mountSingleTenantApp(): Hono {
  const app = new Hono()
  app.use('/api/*', tenantMiddleware)
  app.use('/api/*', vaultGateMiddleware)
  app.route('/api/vault', vaultRoute)
  app.route('/api/devices', devicesRoute)
  app.route('/api/ingest', ingestRoute)
  return app
}

describe('/api/ingest/imessage', () => {
  it('supports ingest, cursor, duplicate batch, and wipe', async () => {
    const uid = generateUserId()
    const { sid, token } = await mintTenantSessionAndDeviceToken(uid)
    const home = tenantHomeDir(uid)

    const app = mountSingleTenantApp()

    const ingest = await app.request('http://localhost/api/ingest/imessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_id: 'mac-abc',
        batch: [
          {
            guid: 'm-1',
            rowid: 10,
            date_ms: Date.parse('2026-04-27T12:00:00.000Z'),
            text: 'hello world',
            is_from_me: false,
            handle: '+15550001111',
            chat_identifier: '+15550001111',
            service: 'iMessage',
          },
        ],
      }),
    })
    expect(ingest.status).toBe(200)
    const ingestJson = (await ingest.json()) as { accepted: number; last_rowid: number }
    expect(ingestJson.accepted).toBe(1)
    expect(ingestJson.last_rowid).toBe(10)

    const dup = await app.request('http://localhost/api/ingest/imessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_id: 'mac-abc',
        batch: [
          {
            guid: 'm-1',
            rowid: 10,
            date_ms: Date.parse('2026-04-27T12:00:00.000Z'),
            text: 'hello updated',
            is_from_me: false,
            handle: '+15550001111',
            chat_identifier: '+15550001111',
            service: 'iMessage',
          },
        ],
      }),
    })
    expect(dup.status).toBe(200)
    await runWithTenantContextAsync(
      { tenantUserId: uid, workspaceHandle: uid, homeDir: home },
      async () => {
        expect(searchImessageMessages('updated', 10)).toHaveLength(1)
      },
    )

    const cursor = await app.request('http://localhost/api/ingest/imessage/cursor?device_id=mac-abc', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(cursor.status).toBe(200)
    const cursorJson = (await cursor.json()) as { rowid: number }
    expect(cursorJson.rowid).toBe(10)

    const wipe = await app.request('http://localhost/api/ingest/imessage/wipe', {
      method: 'POST',
      headers: { Cookie: `brain_session=${sid}` },
    })
    expect(wipe.status).toBe(200)
    const wipeJson = (await wipe.json()) as { deleted: number }
    expect(wipeJson.deleted).toBe(1)
  })

  it('rejects invalid device token', async () => {
    const app = mountSingleTenantApp()
    const res = await app.request('http://localhost/api/ingest/imessage', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bad-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batch: [] }),
    })
    expect(res.status).toBe(401)
  })

  it('does not allow device token to call wipe endpoint', async () => {
    const uid = generateUserId()
    const { token } = await mintTenantSessionAndDeviceToken(uid)

    const app = mountSingleTenantApp()
    const res = await app.request('http://localhost/api/ingest/imessage/wipe', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })
})

describe('/api/ingest/imessage multi-tenant isolation', () => {
  it('isolates data by token tenant', async () => {
    const mtRoot = await mkdtemp(join(tmpdir(), 'ingest-route-mt-'))
    delete process.env.BRAIN_HOME
    process.env.BRAIN_DATA_ROOT = mtRoot

    const tA = 'usr_aaaaaaaaaaaaaaaaaaaa'
    const tB = 'usr_bbbbbbbbbbbbbbbbbbbb'
    ensureTenantHomeDir(tA)
    ensureTenantHomeDir(tB)
    const tokenA = await runWithTenantContextAsync(
      { tenantUserId: tA, workspaceHandle: 'a', homeDir: tenantHomeDir(tA) },
      async () => (await mintDeviceToken({ label: 'A', homeDir: tenantHomeDir(tA) })).token,
    )
    const tokenB = await runWithTenantContextAsync(
      { tenantUserId: tB, workspaceHandle: 'b', homeDir: tenantHomeDir(tB) },
      async () => (await mintDeviceToken({ label: 'B', homeDir: tenantHomeDir(tB) })).token,
    )

    const app = new Hono()
    app.route('/api/ingest', ingestRoute)

    const inA = await app.request('http://localhost/api/ingest/imessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_id: 'shared-device',
        batch: [
          {
            guid: 'a-1',
            rowid: 5,
            date_ms: Date.now(),
            text: 'tenant a message',
            is_from_me: false,
            handle: null,
            chat_identifier: null,
          },
        ],
      }),
    })
    expect(inA.status).toBe(200)

    const inB = await app.request('http://localhost/api/ingest/imessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenB}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_id: 'shared-device',
        batch: [
          {
            guid: 'b-1',
            rowid: 2,
            date_ms: Date.now(),
            text: 'tenant b message',
            is_from_me: false,
            handle: null,
            chat_identifier: null,
          },
        ],
      }),
    })
    expect(inB.status).toBe(200)

    const curA = await app.request('http://localhost/api/ingest/imessage/cursor?device_id=shared-device', {
      headers: { Authorization: `Bearer ${tokenA}` },
    })
    const curB = await app.request('http://localhost/api/ingest/imessage/cursor?device_id=shared-device', {
      headers: { Authorization: `Bearer ${tokenB}` },
    })
    expect(curA.status).toBe(200)
    expect(curB.status).toBe(200)
    const curAj = (await curA.json()) as { rowid: number }
    const curBj = (await curB.json()) as { rowid: number }
    expect(curAj.rowid).toBe(5)
    expect(curBj.rowid).toBe(2)

    await rm(mtRoot, { recursive: true, force: true })
  })
})
