import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import wikiSharesRoute from './wikiShares.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { registerIdentityWorkspace, registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { googleIdentityKey } from '@server/lib/tenant/googleIdentityWorkspace.js'
import { brainLayoutRipmailDir, brainLayoutWikiDir } from '@server/lib/platform/brainLayout.js'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { getShareByToken } from '@server/lib/shares/wikiSharesRepo.js'

vi.mock('@server/lib/shares/shareInviteEmail.js', () => ({
  sendWikiShareInviteEmail: vi.fn().mockResolvedValue({ sent: false }),
}))

function mountWikiShares(): Hono {
  const app = new Hono()
  app.use('/api/*', tenantMiddleware)
  app.use('/api/*', vaultGateMiddleware)
  app.route('/api/wiki-shares', wikiSharesRoute)
  return app
}

describe('/api/wiki-shares', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH
  let root: string
  let dbPath: string

  beforeEach(async () => {
    delete process.env.BRAIN_HOME
    root = await mkdtemp(join(tmpdir(), 'wsh-api-'))
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
    vi.clearAllMocks()
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

  it('POST create, GET list, DELETE revoke, GET accept redirects', async () => {
    const ownerId = 'usr_10101010101010101010'
    const granteeId = 'usr_20202020202020202020'
    const ownerSid = await sessionFor(ownerId, 'owner-handle')
    await registerSessionTenant(ownerSid, ownerId)

    const wiki = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(wiki, 'trips'), { recursive: true })
    await writeFile(join(wiki, 'trips', 'hello.md'), '# Hi\n', 'utf-8')

    const granteeSid = await sessionFor(granteeId, 'grantee-handle')
    await registerSessionTenant(granteeSid, granteeId)
    const rip = brainLayoutRipmailDir(tenantHomeDir(granteeId))
    await mkdir(rip, { recursive: true })
    await writeFile(
      join(rip, 'config.json'),
      JSON.stringify({
        sources: [
          {
            id: 'mb',
            kind: 'imap',
            email: 'grantee@example.com',
            imap: { host: 'imap.gmail.com', port: 993 },
            imapAuth: 'googleOAuth',
          },
        ],
      }),
      'utf-8',
    )

    const app = mountWikiShares()
    const post = await app.request('http://localhost/api/wiki-shares', {
      method: 'POST',
      headers: { Cookie: `brain_session=${ownerSid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathPrefix: 'trips/', granteeEmail: 'grantee@example.com' }),
    })
    expect(post.status).toBe(200)
    const created = (await post.json()) as { id: string; inviteUrl: string; emailSent: boolean }
    expect(created.inviteUrl).toContain('/api/wiki-shares/accept/')
    expect(created.emailSent).toBe(false)

    const listOwner = await app.request('http://localhost/api/wiki-shares', {
      headers: { Cookie: `brain_session=${ownerSid}` },
    })
    expect(listOwner.status).toBe(200)
    const lo = (await listOwner.json()) as { owned: { id: string }[] }
    expect(lo.owned).toHaveLength(1)

    const token = created.inviteUrl.split('/accept/')[1] ?? ''
    expect(token.length).toBeGreaterThan(5)

    const acc = await app.request(`http://localhost/api/wiki-shares/accept/${encodeURIComponent(token)}`, {
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(acc.status).toBe(302)
    const loc = acc.headers.get('location') ?? ''
    expect(loc).toContain('/wiki/@owner-handle/trips/')

    const row = getShareByToken(decodeURIComponent(token))
    expect(row?.grantee_id).toBe(granteeId)

    const del = await app.request(`http://localhost/api/wiki-shares/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: `brain_session=${granteeSid}` },
    })
    expect(del.status).toBe(404)

    const delOk = await app.request(`http://localhost/api/wiki-shares/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: `brain_session=${ownerSid}` },
    })
    expect(delOk.status).toBe(200)
  })

  it('POST resolves granteeHandle to the tenant primary email', async () => {
    const ownerId = 'usr_30303030303030303030'
    const granteeId = 'usr_40404040404040404040'
    const ownerSid = await sessionFor(ownerId, 'owner-h2')
    await registerSessionTenant(ownerSid, ownerId)

    const wiki = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(wiki, 'trips'), { recursive: true })

    const granteeSid = await sessionFor(granteeId, 'sterling')
    await registerSessionTenant(granteeSid, granteeId)
    const rip = brainLayoutRipmailDir(tenantHomeDir(granteeId))
    await mkdir(rip, { recursive: true })
    await writeFile(
      join(rip, 'config.json'),
      JSON.stringify({
        sources: [
          {
            id: 'mb',
            kind: 'imap',
            email: 'sterling@example.com',
            imap: { host: 'imap.gmail.com', port: 993 },
            imapAuth: 'googleOAuth',
          },
        ],
      }),
      'utf-8',
    )

    const app = mountWikiShares()
    const post = await app.request('http://localhost/api/wiki-shares', {
      method: 'POST',
      headers: { Cookie: `brain_session=${ownerSid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathPrefix: 'trips/', granteeHandle: '@sterling' }),
    })
    expect(post.status).toBe(200)
    const created = (await post.json()) as {
      granteeEmail: string
      granteeHandle?: string
      inviteUrl: string
    }
    expect(created.granteeEmail).toBe('sterling@example.com')
    expect(created.granteeHandle).toBe('sterling')
    expect(created.inviteUrl).toContain('/api/wiki-shares/accept/')
  })

  it('POST returns 400 when handle is unknown', async () => {
    const ownerId = 'usr_50505050505050505050'
    const ownerSid = await sessionFor(ownerId, 'owner-h3')
    await registerSessionTenant(ownerSid, ownerId)

    const app = mountWikiShares()
    const res = await app.request('http://localhost/api/wiki-shares', {
      method: 'POST',
      headers: { Cookie: `brain_session=${ownerSid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathPrefix: 'trips/', granteeHandle: 'nobody-here' }),
    })
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: string }
    expect(j.error).toBe('handle_not_found')
  })

  it('POST returns 400 when handle resolves but tenant has no email yet', async () => {
    const ownerId = 'usr_60606060606060606060'
    const granteeId = 'usr_70707070707070707070'
    const ownerSid = await sessionFor(ownerId, 'owner-h4')
    await registerSessionTenant(ownerSid, ownerId)

    await sessionFor(granteeId, 'newcomer')

    const app = mountWikiShares()
    const res = await app.request('http://localhost/api/wiki-shares', {
      method: 'POST',
      headers: { Cookie: `brain_session=${ownerSid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pathPrefix: 'trips/', granteeHandle: 'newcomer' }),
    })
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: string }
    expect(j.error).toBe('handle_has_no_email')
  })

  it('POST rejects when both granteeEmail and granteeHandle are provided', async () => {
    const ownerId = 'usr_80808080808080808080'
    const ownerSid = await sessionFor(ownerId, 'owner-h5')
    await registerSessionTenant(ownerSid, ownerId)

    const app = mountWikiShares()
    const res = await app.request('http://localhost/api/wiki-shares', {
      method: 'POST',
      headers: { Cookie: `brain_session=${ownerSid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pathPrefix: 'trips/',
        granteeEmail: 'a@example.com',
        granteeHandle: 'cirne',
      }),
    })
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: string }
    expect(j.error).toBe('grantee_conflict')
  })
})
