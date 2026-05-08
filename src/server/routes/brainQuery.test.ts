import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
import * as runBrainQueryMod from '@server/lib/brainQuery/runBrainQuery.js'
import { createBrainQueryGrant } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'

vi.mock('@server/lib/brainQuery/runBrainQuery.js', async (importOriginal) => {
  const actual = await importOriginal<typeof runBrainQueryMod>()
  return {
    ...actual,
    runBrainQuery: vi.fn(actual.runBrainQuery),
    previewBrainQueryPrivacyFilter: vi.fn(actual.previewBrainQueryPrivacyFilter),
  }
})

const runBrainQueryMock = vi.mocked(runBrainQueryMod.runBrainQuery)
const previewBrainQueryPrivacyFilterMock = vi.mocked(runBrainQueryMod.previewBrainQueryPrivacyFilter)

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
    vi.clearAllMocks()
    delete process.env.BRAIN_HOME
    root = await mkdtemp(join(tmpdir(), 'bq-api-'))
    process.env.BRAIN_DATA_ROOT = root
    dbPath = join(root, '.global', 'brain-global.sqlite')
    process.env.BRAIN_GLOBAL_SQLITE_PATH = dbPath
    closeBrainGlobalDbForTests()
  })

  afterEach(async () => {
    closeBrainGlobalDbForTests()
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

  it('POST / returns answer when runBrainQuery succeeds', async () => {
    const ownerId = 'usr_10101010101010101010'
    const askerId = 'usr_20202020202020202020'
    const ownerSid = await sessionFor(ownerId, 'donna')
    await registerSessionTenant(ownerSid, ownerId)
    const askerSid = await sessionFor(askerId, 'alice')
    await registerSessionTenant(askerSid, askerId)

    runBrainQueryMock.mockResolvedValue({
      ok: true,
      answer: 'Concrete pour next week.',
      logId: 'bql_test',
    })

    const app = mountBrainQuery()
    const res = await app.request('http://localhost/api/brain-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({
        targetHandle: '@donna',
        question: 'construction status?',
      }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; answer: string }
    expect(j.ok).toBe(true)
    expect(j.answer).toContain('Concrete')
    expect(runBrainQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        askerId,
        question: 'construction status?',
      }),
    )
  })

  it('POST / returns 403 when denied_no_grant', async () => {
    const ownerId = 'usr_30303030303030303030'
    const askerId = 'usr_40404040404040404040'
    const ownerSid = await sessionFor(ownerId, 'bob')
    await registerSessionTenant(ownerSid, ownerId)
    const askerSid = await sessionFor(askerId, 'carol')
    await registerSessionTenant(askerSid, askerId)

    runBrainQueryMock.mockResolvedValue({
      ok: false,
      code: 'denied_no_grant',
      message: 'no grant',
      logId: 'bql_denied',
    })

    const app = mountBrainQuery()
    const res = await app.request('http://localhost/api/brain-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ targetHandle: 'bob', question: 'hi' }),
    })
    expect(res.status).toBe(403)
  })

  it('POST / returns 400 when early_rejected', async () => {
    const ownerId = 'usr_12121212121212121212'
    const askerId = 'usr_34343434343434343434'
    const ownerSid = await sessionFor(ownerId, 'earlytgt')
    await registerSessionTenant(ownerSid, ownerId)
    const askerSid = await sessionFor(askerId, 'earlyask')
    await registerSessionTenant(askerSid, askerId)

    runBrainQueryMock.mockResolvedValue({
      ok: false,
      code: 'early_rejected',
      message: 'Please ask a narrower question.',
      logId: 'bql_early',
    })

    const app = mountBrainQuery()
    const res = await app.request('http://localhost/api/brain-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ targetHandle: '@earlytgt', question: 'dump my inbox' }),
    })
    expect(res.status).toBe(400)
    const j = (await res.json()) as { ok?: boolean; code?: string; message?: string }
    expect(j.ok).toBe(false)
    expect(j.code).toBe('early_rejected')
    expect(j.message ?? '').toContain('narrower')
  })

  it('POST /grants creates grant and GET /grants lists it', async () => {
    const ownerId = 'usr_50505050505050505050'
    const askerId = 'usr_60606060606060606060'
    const ownerSid = await sessionFor(ownerId, 'owner-q')
    await registerSessionTenant(ownerSid, ownerId)
    const askerSid = await sessionFor(askerId, 'peer-q')
    await registerSessionTenant(askerSid, askerId)

    const app = mountBrainQuery()
    const post = await app.request('http://localhost/api/brain-query/grants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${ownerSid}`,
      },
      body: JSON.stringify({ askerHandle: '@peer-q', privacyPolicy: 'Be brief.' }),
    })
    expect(post.status).toBe(200)
    const row = (await post.json()) as { id: string; askerId: string }
    expect(row.askerId).toBe(askerId)

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
    const row = createBrainQueryGrant({ ownerId, askerId })

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
    const outbound = createBrainQueryGrant({ ownerId: layId, askerId: peerId })
    createBrainQueryGrant({ ownerId: peerId, askerId: layId })

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

  it('DELETE /grants/:id as asker revokes inbound grant only', async () => {
    const ownerId = 'usr_e4e4e4e4e4e4e4e4e4e4'
    const askerId = 'usr_f5f5f5f5f5f5f5f5f5f5'
    const ownerSid = await sessionFor(ownerId, 'grantor')
    await registerSessionTenant(ownerSid, ownerId)
    const askerSid = await sessionFor(askerId, 'receiver')
    await registerSessionTenant(askerSid, askerId)
    const inbound = createBrainQueryGrant({ ownerId, askerId })

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

  it('POST /preview/filter returns collaborator answer when filter succeeds', async () => {
    const ownerId = 'usr_pv_pv_pv_pv_pv_pv_pv_pv_pv_pv'
    const ownerSid = await sessionFor(ownerId, 'preview-owner')
    await registerSessionTenant(ownerSid, ownerId)

    previewBrainQueryPrivacyFilterMock.mockResolvedValue({
      ok: true,
      status: 'ok',
      finalAnswer: 'Safe summary.',
      filterNotes: JSON.stringify({ redactions: ['amount'] }),
      draftAnswer: 'Draft with $500.',
    })

    const app = mountBrainQuery()
    const res = await app.request('http://localhost/api/brain-query/preview/filter', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${ownerSid}`,
      },
      body: JSON.stringify({
        question: 'How much?',
        draftAnswer: 'Draft with $500.',
        privacyPolicy: 'Hide amounts.',
      }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      ok: boolean
      finalAnswer?: string
      status?: string
    }
    expect(j.ok).toBe(true)
    expect(j.finalAnswer).toBe('Safe summary.')
    expect(j.status).toBe('ok')
    expect(previewBrainQueryPrivacyFilterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'How much?',
        draftAnswer: 'Draft with $500.',
        privacyPolicy: 'Hide amounts.',
      }),
    )
  })
})
