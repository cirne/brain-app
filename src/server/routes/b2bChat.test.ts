import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import b2bChatRoute from './b2bChat.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { registerIdentityWorkspace, registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { googleIdentityKey } from '@server/lib/tenant/googleIdentityWorkspace.js'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
import { createBrainQueryGrant } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'

function mountB2BChat(): Hono {
  const app = new Hono()
  app.use('/api/*', tenantMiddleware)
  app.use('/api/*', vaultGateMiddleware)
  app.route('/api/chat/b2b', b2bChatRoute)
  return app
}

describe('/api/chat/b2b', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH
  let root: string

  beforeEach(async () => {
    closeTenantDbForTests()
    closeBrainGlobalDbForTests()
    root = await mkdtemp(join(tmpdir(), 'b2b-chat-api-'))
    process.env.BRAIN_DATA_ROOT = root
    process.env.BRAIN_GLOBAL_SQLITE_PATH = join(root, '.global', 'brain-global.sqlite')
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

  it('GET /tunnels lists active grants for the current asker', async () => {
    const ownerId = 'usr_a1111111111111111111'
    const askerId = 'usr_b2222222222222222222'
    await sessionFor(ownerId, 'demo-ken-lay')
    const askerSid = await sessionFor(askerId, 'demo-steve-kean')
    await registerSessionTenant(askerSid, askerId)
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Leadership summaries only.' })

    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/tunnels', {
      headers: { cookie: `brain_session=${askerSid}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tunnels: Array<{ grantId: string; ownerHandle: string; sessionId: string | null }> }
    expect(body.tunnels).toEqual([
      expect.objectContaining({
        grantId: grant.id,
        ownerHandle: 'demo-ken-lay',
        sessionId: null,
      }),
    ])
  })

  it('POST /ensure-session creates a stable outbound session for an active grant', async () => {
    const ownerId = 'usr_own1111111111111111111'
    const askerId = 'usr_ask2222222222222222222'
    await sessionFor(ownerId, 'demo-ken-lay')
    const askerSid = await sessionFor(askerId, 'demo-steve-kean')
    await registerSessionTenant(askerSid, askerId)
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })

    const app = mountB2BChat()
    const res1 = await app.request('http://localhost/api/chat/b2b/ensure-session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ grantId: grant.id }),
    })
    expect(res1.status).toBe(200)
    const body1 = (await res1.json()) as { sessionId?: string }
    expect(typeof body1.sessionId).toBe('string')
    expect(body1.sessionId!.length).toBeGreaterThan(0)

    const res2 = await app.request('http://localhost/api/chat/b2b/ensure-session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ grantId: grant.id }),
    })
    expect(res2.status).toBe(200)
    const body2 = (await res2.json()) as { sessionId?: string }
    expect(body2.sessionId).toBe(body1.sessionId)
  })

  it('POST /send rejects when no active grant exists', async () => {
    const askerId = 'usr_c3333333333333333333'
    const askerSid = await sessionFor(askerId, 'demo-steve-kean')
    await registerSessionTenant(askerSid, askerId)

    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ grantId: 'bqg_missing', message: 'Ask Ken.' }),
    })
    expect(res.status).toBe(403)
  })
})
