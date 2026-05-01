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
import { acceptShare, createShare } from '@server/lib/shares/wikiSharesRepo.js'

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
      granteeEmail: 'g@g.com',
      pathPrefix: 'trips',
    })
    acceptShare({
      token: share.invite_token,
      granteeId,
      granteeEmail: 'g@g.com',
    })

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
      granteeEmail: 'grantee@example.com',
      pathPrefix: 'trips/',
    })
    acceptShare({
      token: share.invite_token,
      granteeId,
      granteeEmail: 'grantee@example.com',
    })

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
})
