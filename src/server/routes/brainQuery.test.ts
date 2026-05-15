import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import brainQueryRoute from './brainQuery.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { registerIdentityWorkspace, registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { googleIdentityKey } from '@server/lib/tenant/googleIdentityWorkspace.js'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { listNotifications } from '@server/lib/notifications/notificationsRepo.js'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
import { createBrainQueryGrant } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { createBrainQueryCustomPolicy } from '@server/lib/brainQuery/brainQueryCustomPoliciesRepo.js'
import { ensureSessionStub, loadSession } from '@server/lib/chat/chatStorage.js'

function mountBrainQuery(): Hono {
  const app = new Hono()
  app.use('/api/*', tenantMiddleware)
  app.use('/api/*', vaultGateMiddleware)
  app.route('/api/brain-query', brainQueryRoute)
  return app
}

describe('/api/brain-query', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH
  let root: string
  let dbPath: string

  beforeEach(async () => {
    closeTenantDbForTests()
    delete process.env.BRAIN_HOME
    root = await mkdtemp(join(tmpdir(), 'bq-api-'))
    process.env.BRAIN_DATA_ROOT = root
    dbPath = join(root, '.global', 'brain-global.sqlite')
    process.env.BRAIN_GLOBAL_SQLITE_PATH = dbPath
    closeBrainGlobalDbForTests()
  })

  afterEach(async () => {
    closeBrainGlobalDbForTests()
    closeTenantDbForTests()
    delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    delete process.env.BRAIN_DATA_ROOT
    if (prevRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevRoot
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    await rm(root, { recursive: true, force: true })
  })

  async function sessionFor(uid: string, handle: string): Promise<string> {
    ensureTenantHomeDir(uid)
    await writeHandleMeta(tenantHomeDir(uid), {
      userId: uid,
      handle,
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    const key = googleIdentityKey(`sub-${uid.slice(-8)}`)
    await registerIdentityWorkspace(key, uid)
    return runWithTenantContextAsync(
      { tenantUserId: uid, workspaceHandle: handle, homeDir: tenantHomeDir(uid) },
      async () => createVaultSession(),
    )
  }

  it('POST /grants creates grant and GET /grants lists it', async () => {
    const ownerId = 'usr_50505050505050505050'
    const askerId = 'usr_60606060606060606060'
    const ownerSid = await sessionFor(ownerId, 'owner-q')
    await registerSessionTenant(ownerSid, ownerId)
    const askerSid = await sessionFor(askerId, 'peer-q')
    await registerSessionTenant(askerSid, askerId)

    const custom = createBrainQueryCustomPolicy({ ownerId, title: 't', body: 'Be brief.' })

    const app = mountBrainQuery()
    const post = await app.request('http://localhost/api/brain-query/grants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${ownerSid}`,
      },
      body: JSON.stringify({ askerHandle: '@peer-q', customPolicyId: custom.id }),
    })
    expect(post.status).toBe(200)
    const row = (await post.json()) as { id: string; askerId: string; ownerHandle: string }
    expect(row.askerId).toBe(askerId)

    const askerNotifs = await runWithTenantContextAsync(
      { tenantUserId: askerId, workspaceHandle: 'peer-q', homeDir: tenantHomeDir(askerId) },
      async () => listNotifications({}),
    )
    expect(askerNotifs).toHaveLength(1)
    expect(askerNotifs[0].sourceKind).toBe('brain_query_grant_received')
    expect(askerNotifs[0].idempotencyKey).toBe(`brain_query_grant:${row.id}`)
    const p = askerNotifs[0].payload as Record<string, unknown>
    expect(p.grantId).toBe(row.id)
    expect(p.ownerId).toBe(ownerId)
    expect(p.ownerHandle).toBe('owner-q')
    expect(p.privacyPolicyPreview).toBe('Be brief.')

    const getGrants = await app.request('http://localhost/api/brain-query/grants', {
      headers: { cookie: `brain_session=${ownerSid}` },
    })
    expect(getGrants.status).toBe(200)
    const list = (await getGrants.json()) as { grantedByMe: { id: string }[] }
    expect(list.grantedByMe.some((g) => g.id === row.id)).toBe(true)
  })

  it('DELETE /grants/:id revokes', async () => {
    const ownerId = 'usr_70707070707070707070'
    const askerId = 'usr_80808080808080808080'
    const ownerSid = await sessionFor(ownerId, 'rev-owner')
    await registerSessionTenant(ownerSid, ownerId)
    await sessionFor(askerId, 'to-revoke')
    const row = createBrainQueryGrant({ ownerId, askerId, presetPolicyKey: 'general' })

    const app = mountBrainQuery()
    const del = await app.request(`http://localhost/api/brain-query/grants/${row.id}`, {
      method: 'DELETE',
      headers: { cookie: `brain_session=${ownerSid}` },
    })
    expect(del.status).toBe(200)
  })

  it('DELETE /grants/:id as owner revokes reciprocal pair', async () => {
    const layId = 'usr_c2c2c2c2c2c2c2c2c2c2'
    const peerId = 'usr_d3d3d3d3d3d3d3d3d3d3'
    const laySid = await sessionFor(layId, 'lay-demo')
    await registerSessionTenant(laySid, layId)
    await sessionFor(peerId, 'peer-demo')
    const outbound = createBrainQueryGrant({ ownerId: layId, askerId: peerId, presetPolicyKey: 'general' })
    createBrainQueryGrant({ ownerId: peerId, askerId: layId, presetPolicyKey: 'general' })

    const app = mountBrainQuery()
    const del = await app.request(`http://localhost/api/brain-query/grants/${outbound.id}`, {
      method: 'DELETE',
      headers: { cookie: `brain_session=${laySid}` },
    })
    expect(del.status).toBe(200)
    const listRes = await app.request('http://localhost/api/brain-query/grants', {
      headers: { cookie: `brain_session=${laySid}` },
    })
    expect(listRes.status).toBe(200)
    const body = (await listRes.json()) as { grantedByMe: unknown[]; grantedToMe: unknown[] }
    expect(body.grantedByMe).toHaveLength(0)
    expect(body.grantedToMe).toHaveLength(0)
  })

  it('DELETE /grants/:id as owner clears inbound stubs for that grant', async () => {
    const ownerId = 'usr_own_del_inbx_aaaaaaaaaaaa'
    const askerId = 'usr_peer_del_inbx_bbbbbbbbbbbb'
    const ownerSid = await sessionFor(ownerId, 'inbx-owner-api')
    await registerSessionTenant(ownerSid, ownerId)
    await sessionFor(askerId, 'inbx-asker-api')
    const briefPol = createBrainQueryCustomPolicy({ ownerId, title: 'b', body: 'Brief.' })
    const grant = createBrainQueryGrant({ ownerId, askerId, customPolicyId: briefPol.id })
    const inboundSid = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'inbx-owner-api', homeDir: tenantHomeDir(ownerId) },
      async () => {
        await ensureSessionStub(inboundSid, {
          sessionType: 'b2b_inbound',
          remoteGrantId: grant.id,
          remoteHandle: 'inbx-asker-api',
          remoteDisplayName: 'Peer',
          approvalState: 'pending',
        })
        expect(await loadSession(inboundSid)).not.toBeNull()
      },
    )

    const app = mountBrainQuery()
    const del = await app.request(`http://localhost/api/brain-query/grants/${grant.id}`, {
      method: 'DELETE',
      headers: { cookie: `brain_session=${ownerSid}` },
    })
    expect(del.status).toBe(200)

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'inbx-owner-api', homeDir: tenantHomeDir(ownerId) },
      async () => {
        expect(await loadSession(inboundSid)).toBeNull()
      },
    )
  })

  it('DELETE /grants/:id as asker clears owner inbound stubs for that grant', async () => {
    const ownerId = 'usr_own_ask_rev_eeeeeeeeeeeeee'
    const askerId = 'usr_peer_ask_rev_ffffffffffff'
    await sessionFor(ownerId, 'ask-rev-own')
    const askerSid = await sessionFor(askerId, 'ask-rev-peer')
    await registerSessionTenant(askerSid, askerId)
    const briefPol2 = createBrainQueryCustomPolicy({ ownerId, title: 'b2', body: 'Brief.' })
    const inbound = createBrainQueryGrant({ ownerId, askerId, customPolicyId: briefPol2.id })
    const inboundSid = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'ask-rev-own', homeDir: tenantHomeDir(ownerId) },
      async () => {
        await ensureSessionStub(inboundSid, {
          sessionType: 'b2b_inbound',
          remoteGrantId: inbound.id,
          remoteHandle: 'ask-rev-peer',
          approvalState: 'pending',
        })
      },
    )

    const app = mountBrainQuery()
    const del = await app.request(`http://localhost/api/brain-query/grants/${inbound.id}`, {
      method: 'DELETE',
      headers: { cookie: `brain_session=${askerSid}` },
    })
    expect(del.status).toBe(200)

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'ask-rev-own', homeDir: tenantHomeDir(ownerId) },
      async () => {
        expect(await loadSession(inboundSid)).toBeNull()
      },
    )
  })

  it('DELETE /grants/:id as asker revokes inbound grant only', async () => {
    const ownerId = 'usr_e4e4e4e4e4e4e4e4e4e4'
    const askerId = 'usr_f5f5f5f5f5f5f5f5f5f5'
    const ownerSid = await sessionFor(ownerId, 'grantor')
    await registerSessionTenant(ownerSid, ownerId)
    const askerSid = await sessionFor(askerId, 'receiver')
    await registerSessionTenant(askerSid, askerId)
    const inbound = createBrainQueryGrant({ ownerId, askerId, presetPolicyKey: 'general' })

    const app = mountBrainQuery()
    const del = await app.request(`http://localhost/api/brain-query/grants/${inbound.id}`, {
      method: 'DELETE',
      headers: { cookie: `brain_session=${askerSid}` },
    })
    expect(del.status).toBe(200)

    const peerList = await app.request('http://localhost/api/brain-query/grants', {
      headers: { cookie: `brain_session=${ownerSid}` },
    })
    const peerBody = (await peerList.json()) as { grantedByMe: { askerId: string }[] }
    expect(peerBody.grantedByMe.some((g) => g.askerId === askerId)).toBe(false)
  })
})
