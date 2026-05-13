import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import b2bChatRoute from './b2bChat.js'
import { tenantMiddleware } from '@server/lib/tenant/tenantMiddleware.js'
import { vaultGateMiddleware } from '@server/lib/vault/vaultGate.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { registerIdentityWorkspace, registerSessionTenant } from '@server/lib/tenant/tenantRegistry.js'
import { createVaultSession } from '@server/lib/vault/vaultSessionStore.js'
import { writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { googleIdentityKey } from '@server/lib/tenant/googleIdentityWorkspace.js'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
import { B2B_OUTBOUND_AWAITING_PEER_REVIEW_TEXT } from '@shared/b2bTunnelDelivery.js'
import { createBrainQueryGrant, setBrainQueryGrantAutoSend } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'

vi.mock('@server/agent/b2bAgent.js', () => ({
  createB2BAgent: vi.fn(() => ({})),
  promptB2BAgentForText: vi.fn(async () => 'Mock agent answer'),
  filterB2BResponse: vi.fn(async ({ draftAnswer }: { draftAnswer: string }) => draftAnswer),
}))

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

  it('GET /inbound-session/:grantId returns inbound session id for the grant owner', async () => {
    const ownerId = 'usr_own5555555555555555555'
    const askerId = 'usr_ask6666666666666666666'
    const ownerSid = await sessionFor(ownerId, 'demo-owner-in')
    await registerSessionTenant(ownerSid, ownerId)
    await sessionFor(askerId, 'demo-asker-in')
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })

    const inboundId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'demo-owner-in', homeDir: tenantHomeDir(ownerId) },
      async () => {
        const { ensureSessionStub } = await import('@server/lib/chat/chatStorage.js')
        await ensureSessionStub(inboundId, {
          sessionType: 'b2b_inbound',
          remoteGrantId: grant.id,
          remoteHandle: 'demo-asker-in',
          remoteDisplayName: 'Asker',
          approvalState: 'auto',
        })
      },
    )

    const app = mountB2BChat()
    const res = await app.request(
      `http://localhost/api/chat/b2b/inbound-session/${encodeURIComponent(grant.id)}`,
      { headers: { cookie: `brain_session=${ownerSid}` } },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sessionId?: string | null }
    expect(body.sessionId).toBe(inboundId)
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

  it('POST /send rejects when grant policy is ignore', async () => {
    const ownerId = 'usr_own_ign_1111111111111111'
    const askerId = 'usr_ask_ign_2222222222222222'
    await sessionFor(ownerId, 'owner-ign')
    const askerSid = await sessionFor(askerId, 'asker-ign')
    await registerSessionTenant(askerSid, askerId)
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })
    const { setBrainQueryGrantPolicy } = await import('@server/lib/brainQuery/brainQueryGrantsRepo.js')
    setBrainQueryGrantPolicy({ grantId: grant.id, ownerId, policy: 'ignore' })

    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ grantId: grant.id, message: 'Hello' }),
    })
    expect(res.status).toBe(403)
    const j = (await res.json()) as { error?: string }
    expect(j.error).toBe('grant_ignored')
  })

  it('POST /send streams awaiting-review placeholder when auto_send is off', async () => {
    const ownerId = 'usr_own7777777777777777777'
    const askerId = 'usr_ask8888888888888888888'
    await sessionFor(ownerId, 'owner-h')
    const askerSid = await sessionFor(askerId, 'asker-h')
    await registerSessionTenant(askerSid, askerId)
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })

    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ grantId: grant.id, message: 'Hello from tunnel' }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain(B2B_OUTBOUND_AWAITING_PEER_REVIEW_TEXT)
  })

  it('POST /send streams agent answer when auto_send is on', async () => {
    const ownerId = 'usr_own6666666666666666666'
    const askerId = 'usr_ask5555555555555555555'
    await sessionFor(ownerId, 'owner-a')
    const askerSid = await sessionFor(askerId, 'asker-a')
    await registerSessionTenant(askerSid, askerId)
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })
    setBrainQueryGrantAutoSend({ grantId: grant.id, ownerId, autoSend: true })

    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ grantId: grant.id, message: 'Hello auto' }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Mock agent answer')
  })

  it('GET /review lists pending inbound rows for the grant owner', async () => {
    const ownerId = 'usr_own4444444444444444444'
    const askerId = 'usr_ask3333333333333333333'
    const ownerSid = await sessionFor(ownerId, 'owner-r')
    await registerSessionTenant(ownerSid, ownerId)
    await sessionFor(askerId, 'asker-r')
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })

    const inboundId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'owner-r', homeDir: tenantHomeDir(ownerId) },
      async () => {
        const { ensureSessionStub, appendTurn } = await import('@server/lib/chat/chatStorage.js')
        await ensureSessionStub(inboundId, {
          sessionType: 'b2b_inbound',
          remoteGrantId: grant.id,
          remoteHandle: 'asker-r',
          remoteDisplayName: 'Asker',
          approvalState: 'pending',
        })
        await appendTurn({
          sessionId: inboundId,
          userMessage: 'Q?',
          assistantMessage: {
            role: 'assistant',
            content: 'Draft here',
            parts: [{ type: 'text', content: 'Draft here' }],
          },
        })
      },
    )

    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/review?state=pending', {
      headers: { cookie: `brain_session=${ownerSid}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ sessionId: string }> }
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.some((r) => r.sessionId === inboundId)).toBe(true)
  })

  it('POST /dismiss marks pending inbound as dismissed without notifying asker', async () => {
    const ownerId = 'usr_own_dismiss_1111111111111111'
    const askerId = 'usr_ask_dismiss_2222222222222222'
    const ownerSid = await sessionFor(ownerId, 'owner-dismiss')
    await registerSessionTenant(ownerSid, ownerId)
    await sessionFor(askerId, 'asker-dismiss')
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })

    const inboundId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'owner-dismiss', homeDir: tenantHomeDir(ownerId) },
      async () => {
        const { ensureSessionStub, appendTurn } = await import('@server/lib/chat/chatStorage.js')
        await ensureSessionStub(inboundId, {
          sessionType: 'b2b_inbound',
          remoteGrantId: grant.id,
          remoteHandle: 'asker-dismiss',
          remoteDisplayName: 'Asker',
          approvalState: 'pending',
        })
        await appendTurn({
          sessionId: inboundId,
          userMessage: 'Q?',
          assistantMessage: {
            role: 'assistant',
            content: 'Draft here',
            parts: [{ type: 'text', content: 'Draft here' }],
          },
        })
      },
    )

    const app = mountB2BChat()
    const dismissRes = await app.request('http://localhost/api/chat/b2b/dismiss', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${ownerSid}`,
      },
      body: JSON.stringify({ sessionId: inboundId }),
    })
    expect(dismissRes.status).toBe(200)
    const dismissBody = (await dismissRes.json()) as { ok?: boolean }
    expect(dismissBody.ok).toBe(true)

    const res = await app.request('http://localhost/api/chat/b2b/review?state=pending', {
      headers: { cookie: `brain_session=${ownerSid}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ sessionId: string }> }
    expect(body.items.some((r) => r.sessionId === inboundId)).toBe(false)
  })

  it('two queries from the same grant create two separate review rows', async () => {
    const ownerId = 'usr_own2020202020202020201'
    const askerId = 'usr_ask2020202020202020202'
    const ownerSid = await sessionFor(ownerId, 'owner-multi')
    await registerSessionTenant(ownerSid, ownerId)
    await sessionFor(askerId, 'asker-multi')
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })

    const { runB2BQueryForGrant } = await import('./b2bChat.js')
    const base = {
      grant,
      ownerDisplayName: 'Owner Multi',
      ownerHandle: 'owner-multi',
      askerDisplayName: 'Asker Multi',
      askerHandle: 'asker-multi',
    }
    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'owner-multi', homeDir: tenantHomeDir(ownerId) },
      async () => {
        const r1 = await runB2BQueryForGrant({ ...base, message: 'First question' })
        const r2 = await runB2BQueryForGrant({ ...base, message: 'Second question' })
        expect(r1.inboundSessionId).not.toBe(r2.inboundSessionId)
      },
    )

    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/review?state=all', {
      headers: { cookie: `brain_session=${ownerSid}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ sessionId: string }> }
    expect(body.items.length).toBeGreaterThanOrEqual(2)
  })

  it('PATCH /grants/:id/auto-send updates flag for owner', async () => {
    const ownerId = 'usr_own9999999999999999999'
    const askerId = 'usr_ask1010101010101010101'
    const ownerSid = await sessionFor(ownerId, 'owner-p')
    await registerSessionTenant(ownerSid, ownerId)
    await sessionFor(askerId, 'asker-p')
    const grant = createBrainQueryGrant({ ownerId, askerId })

    const app = mountB2BChat()
    const res = await app.request(`http://localhost/api/chat/b2b/grants/${encodeURIComponent(grant.id)}/auto-send`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${ownerSid}`,
      },
      body: JSON.stringify({ autoSend: true }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok?: boolean; autoSend?: boolean; policy?: string }
    expect(j.ok).toBe(true)
    expect(j.autoSend).toBe(true)
    expect(j.policy).toBe('auto')
  })
})
