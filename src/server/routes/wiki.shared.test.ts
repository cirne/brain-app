import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import wikiRoute from './wiki.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { registerIdentityWorkspace, registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { googleIdentityKey } from '@server/lib/tenant/googleIdentityWorkspace.js'
import { brainLayoutWikiDir } from '@server/lib/platform/brainLayout.js'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { acceptShare, createShare, revokeShare } from '@server/lib/shares/wikiSharesRepo.js'

function mountWikiMt(): Hono {
  const app = new Hono()
  app.use('/api/*', tenantMiddleware)
  app.use('/api/*', vaultGateMiddleware)
  app.route('/api/wiki', wikiRoute)
  return app
}

describe('/api/wiki/shared', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH
  let root: string
  let dbPath: string

  beforeEach(async () => {
    delete process.env.BRAIN_HOME
    root = await mkdtemp(join(tmpdir(), 'wiki-sh-'))
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

  it('grantee can list and read shared subtree; PATCH blocked; outside prefix forbidden', async () => {
    const ownerId = 'usr_30303030303030303030'
    const granteeId = 'usr_40404040404040404040'
    const ownerSid = await sessionFor(ownerId, 'own')
    await registerSessionTenant(ownerSid, ownerId)
    const granteeSid = await sessionFor(granteeId, 'gnt')
    await registerSessionTenant(granteeSid, granteeId)

    const wiki = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(wiki, 'trips'), { recursive: true })
    await writeFile(join(wiki, 'trips', 'a.md'), '# A\n', 'utf-8')
    await writeFile(join(wiki, 'secret.md'), '# Secret\n', 'utf-8')

    const share = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'g@g.com',
      pathPrefix: 'trips',
    })
    acceptShare({ token: share.invite_token, granteeId })

    const app = mountWikiMt()
    const list = await app.request(
      `http://localhost/api/wiki/shared/${ownerId}?prefix=${encodeURIComponent('trips/')}`,
      { headers: { Cookie: `brain_session=${granteeSid}` } },
    )
    expect(list.status).toBe(200)
    const files = (await list.json()) as { path: string }[]
    expect(files.some((f) => f.path === 'trips/a.md')).toBe(true)
    expect(files.some((f) => f.path === 'secret.md')).toBe(false)

    const readOk = await app.request(`http://localhost/api/wiki/shared/${ownerId}/trips/a.md`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(readOk.status).toBe(200)

    const readDeny = await app.request(`http://localhost/api/wiki/shared/${ownerId}/secret.md`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(readDeny.status).toBe(403)

    const patch = await app.request(`http://localhost/api/wiki/shared/${ownerId}/trips/a.md`, {
      method: 'PATCH',
      headers: { Cookie: `brain_session=${granteeSid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: '# x' }),
    })
    expect(patch.status).toBe(403)
  })

  it('grantee can list and read via shared-by-handle using owner workspace handle', async () => {
    const ownerId = 'usr_50505050505050505050'
    const granteeId = 'usr_60606060606060606060'
    const ownerSid = await sessionFor(ownerId, 'carol')
    await registerSessionTenant(ownerSid, ownerId)
    const granteeSid = await sessionFor(granteeId, 'grant')
    await registerSessionTenant(granteeSid, granteeId)

    const wiki = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(wiki, 'trips'), { recursive: true })
    await writeFile(join(wiki, 'trips', 'z.md'), '# Z\n', 'utf-8')

    const share = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'grantee@example.com',
      pathPrefix: 'trips/',
    })
    acceptShare({ token: share.invite_token, granteeId })

    const app = mountWikiMt()
    const listAll = await app.request(`http://localhost/api/wiki/shared-by-handle/carol`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(listAll.status).toBe(200)
    const files = (await listAll.json()) as { path: string }[]
    expect(files.some((f) => f.path === 'trips/z.md')).toBe(true)

    const listPref = await app.request(
      `http://localhost/api/wiki/shared-by-handle/carol?prefix=${encodeURIComponent('trips/')}`,
      { headers: { Cookie: `brain_session=${granteeSid}` } },
    )
    expect(listPref.status).toBe(200)

    const readOk = await app.request(`http://localhost/api/wiki/shared-by-handle/carol/trips/z.md`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(readOk.status).toBe(200)

    const readDeny = await app.request(`http://localhost/api/wiki/shared-by-handle/wrong-handle/trips/z.md`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(readDeny.status).toBe(403)
  })

  it('path traversal in shared read does not escape owner wiki root', async () => {
    const ownerId = 'usr_trav1111111111111111'
    const granteeId = 'usr_trav2222222222222222'
    const ownerSid = await sessionFor(ownerId, 'travown')
    await registerSessionTenant(ownerSid, ownerId)
    const granteeSid = await sessionFor(granteeId, 'travgnt')
    await registerSessionTenant(granteeSid, granteeId)

    const wiki = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(wiki, 'trips'), { recursive: true })
    await writeFile(join(wiki, 'trips', 'a.md'), '# A\n', 'utf-8')
    await writeFile(join(wiki, 'evil.md'), '# Evil\n', 'utf-8')

    const share = createShare({
      ownerId,
      granteeId,
      granteeEmail: 't@t.com',
      pathPrefix: 'trips',
    })
    acceptShare({ token: share.invite_token, granteeId })

    const app = mountWikiMt()
    const traversal = await app.request(
      `http://localhost/api/wiki/shared/${encodeURIComponent(ownerId)}/trips/../../evil.md`,
      { headers: { Cookie: `brain_session=${granteeSid}` } },
    )
    expect([400, 403]).toContain(traversal.status)
  })

  it('shared list/read denied after revoke (DB only)', async () => {
    const ownerId = 'usr_revk1111111111111111'
    const granteeId = 'usr_revk2222222222222222'
    const ownerSid = await sessionFor(ownerId, 'revkown')
    await registerSessionTenant(ownerSid, ownerId)
    const granteeSid = await sessionFor(granteeId, 'revkgnt')
    await registerSessionTenant(granteeSid, granteeId)

    const wiki = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(wiki, 'shared'), { recursive: true })
    await writeFile(join(wiki, 'shared', 'x.md'), '# X\n', 'utf-8')

    const share = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'rev@x.com',
      pathPrefix: 'shared',
    })
    acceptShare({ token: share.invite_token, granteeId })
    revokeShare({ shareId: share.id, ownerId })

    const app = mountWikiMt()
    const list = await app.request(
      `http://localhost/api/wiki/shared/${ownerId}?prefix=${encodeURIComponent('shared/')}`,
      { headers: { Cookie: `brain_session=${granteeSid}` } },
    )
    expect(list.status).toBe(403)

    const read = await app.request(`http://localhost/api/wiki/shared/${ownerId}/shared/x.md`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(read.status).toBe(403)
  })

  it('shared list with prefix not covered by any row returns 403', async () => {
    const ownerId = 'usr_prfx1111111111111111'
    const granteeId = 'usr_prfx2222222222222222'
    const ownerSid = await sessionFor(ownerId, 'prfxown')
    await registerSessionTenant(ownerSid, ownerId)
    const granteeSid = await sessionFor(granteeId, 'prfxgnt')
    await registerSessionTenant(granteeSid, granteeId)

    const wiki = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(wiki, 'alpha'), { recursive: true })
    await writeFile(join(wiki, 'alpha', 'a.md'), 'a', 'utf-8')

    const share = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'pr@x.com',
      pathPrefix: 'alpha',
    })
    acceptShare({ token: share.invite_token, granteeId })

    const app = mountWikiMt()
    const list = await app.request(
      `http://localhost/api/wiki/shared/${ownerId}?prefix=${encodeURIComponent('beta/')}`,
      { headers: { Cookie: `brain_session=${granteeSid}` } },
    )
    expect(list.status).toBe(403)
  })

  it('shared read with wrong ownerUserId returns 403', async () => {
    const ownerId = 'usr_owna1111111111111111'
    const otherOwner = 'usr_ownb1111111111111111'
    const granteeId = 'usr_grtc1111111111111111'
    const ownerSid = await sessionFor(ownerId, 'ownaa')
    await registerSessionTenant(ownerSid, ownerId)
    const otherSid = await sessionFor(otherOwner, 'ownbb')
    await registerSessionTenant(otherSid, otherOwner)
    const granteeSid = await sessionFor(granteeId, 'grntc')
    await registerSessionTenant(granteeSid, granteeId)

    const wiki = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(wiki, 'd'), { recursive: true })
    await writeFile(join(wiki, 'd', 'f.md'), 'f', 'utf-8')

    const share = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'wo@x.com',
      pathPrefix: 'd',
    })
    acceptShare({ token: share.invite_token, granteeId })

    const app = mountWikiMt()
    const read = await app.request(`http://localhost/api/wiki/shared/${otherOwner}/d/f.md`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(read.status).toBe(403)
  })

  it('shared-by-handle returns 403 when handle is unknown to grantee shares', async () => {
    const ownerId = 'usr_noh111111111111111111'
    const granteeId = 'usr_nog222222222222222222'
    const ownerSid = await sessionFor(ownerId, 'hasinv')
    await registerSessionTenant(ownerSid, ownerId)
    const granteeSid = await sessionFor(granteeId, 'nognt')
    await registerSessionTenant(granteeSid, granteeId)

    const wiki = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(wiki, 'q'), { recursive: true })
    await writeFile(join(wiki, 'q', 'z.md'), 'z', 'utf-8')
    const share = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'nh@x.com',
      pathPrefix: 'q',
    })
    acceptShare({ token: share.invite_token, granteeId })

    const app = mountWikiMt()
    const list = await app.request(`http://localhost/api/wiki/shared-by-handle/nobody-with-this-handle`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(list.status).toBe(403)
  })

  it('grantee with no shares gets 403 on shared-by-handle', async () => {
    const ownerId = 'usr_lone11111111111111111'
    const granteeId = 'usr_emt222222222222222222'
    const ownerSid = await sessionFor(ownerId, 'lonown')
    await registerSessionTenant(ownerSid, ownerId)
    const granteeSid = await sessionFor(granteeId, 'emptg')
    await registerSessionTenant(granteeSid, granteeId)

    await mkdir(brainLayoutWikiDir(tenantHomeDir(ownerId)), { recursive: true })

    const app = mountWikiMt()
    const list = await app.request(`http://localhost/api/wiki/shared-by-handle/lonown`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(list.status).toBe(403)
  })

  it('shared-by-handle picks one owner when two grantors share the same display handle', async () => {
    const ownerAlpha = 'usr_dupa1111111111111111'
    const ownerBeta = 'usr_dupb1111111111111111'
    const granteeId = 'usr_dupg2222222222222222'

    const aSid = await sessionFor(ownerAlpha, 'duphandle')
    await registerSessionTenant(aSid, ownerAlpha)
    const bSid = await sessionFor(ownerBeta, 'duphandle')
    await registerSessionTenant(bSid, ownerBeta)
    const granteeSid = await sessionFor(granteeId, 'dupgrant')
    await registerSessionTenant(granteeSid, granteeId)

    const wikiA = brainLayoutWikiDir(tenantHomeDir(ownerAlpha))
    await mkdir(join(wikiA, 'from-alpha'), { recursive: true })
    await writeFile(join(wikiA, 'from-alpha', 'a.md'), 'ALPHA', 'utf-8')
    const wikiB = brainLayoutWikiDir(tenantHomeDir(ownerBeta))
    await mkdir(join(wikiB, 'from-beta'), { recursive: true })
    await writeFile(join(wikiB, 'from-beta', 'b.md'), 'BETA', 'utf-8')

    const shA = createShare({
      ownerId: ownerAlpha,
      granteeId,
      granteeEmail: 'dup@x.com',
      pathPrefix: 'from-alpha',
    })
    const shB = createShare({
      ownerId: ownerBeta,
      granteeId,
      granteeEmail: 'dup@x.com',
      pathPrefix: 'from-beta',
    })
    acceptShare({ token: shA.invite_token, granteeId })
    acceptShare({ token: shB.invite_token, granteeId })

    const app = mountWikiMt()
    const list = await app.request(`http://localhost/api/wiki/shared-by-handle/duphandle`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(list.status).toBe(200)
    const files = (await list.json()) as { path: string }[]
    const hasAlpha = files.some((f) => f.path.startsWith('from-alpha/'))
    const hasBeta = files.some((f) => f.path.startsWith('from-beta/'))
    expect(hasAlpha && hasBeta).toBe(false)
    expect(hasAlpha || hasBeta).toBe(true)

    const readAlpha = await app.request(`http://localhost/api/wiki/shared-by-handle/duphandle/from-alpha/a.md`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    const readBeta = await app.request(`http://localhost/api/wiki/shared-by-handle/duphandle/from-beta/b.md`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(new Set([readAlpha.status, readBeta.status])).toEqual(new Set([200, 403]))
  })
})
