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
import { B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT } from '@shared/b2bTunnelDelivery.js'
import {
  createBrainQueryGrant,
  getBrainQueryGrantById,
  setBrainQueryGrantAutoSend,
} from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import * as b2bAgent from '@server/agent/b2bAgent.js'
import { ensureSessionStub, loadSession, listInboundSessionIdsForRemoteGrant } from '@server/lib/chat/chatStorage.js'
import { recordColdQuerySent } from '@server/lib/global/coldQueryRateLimits.js'

vi.mock('@server/agent/b2bAgent.js', () => ({
  createB2BAgent: vi.fn(() => ({})),
  promptB2BAgentForText: vi.fn(async () => 'Mock agent answer'),
  filterB2BResponse: vi.fn(async ({ draftAnswer }: { draftAnswer: string }) => draftAnswer),
  runB2BPreflight: vi.fn(async () => true),
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
    const body = (await res.json()) as { tunnels: Array<Record<string, unknown>> }
    expect(Array.isArray(body.tunnels)).toBe(true)
    expect(body.tunnels.length).toBeGreaterThan(0)
    expect(body.tunnels[0]).toEqual(
      expect.objectContaining({
        peerHandle: 'demo-ken-lay',
        outboundGrantId: grant.id,
        snippet: expect.any(String),
        lastActivityMs: expect.any(Number),
        pendingReviewCount: expect.any(Number),
      }),
    )

    const tl = await app.request(
      `http://localhost/api/chat/b2b/tunnel-timeline/${encodeURIComponent('demo-ken-lay')}`,
      { headers: { cookie: `brain_session=${askerSid}` } },
    )
    expect(tl.status).toBe(200)
    const tlJson = (await tl.json()) as { timeline?: unknown[]; peerHandle?: string }
    expect(tlJson.peerHandle).toBe('demo-ken-lay')
    expect(Array.isArray(tlJson.timeline)).toBe(true)
  })

  it('GET /tunnel-timeline labels outbound user turns as you and inbound peer questions as them', async () => {
    const ownerId = 'usr_a1111111111111111111'
    const askerId = 'usr_b2222222222222222222'
    const ownerSid = await sessionFor(ownerId, 'demo-ken-lay')
    await registerSessionTenant(ownerSid, ownerId)
    const askerSid = await sessionFor(askerId, 'demo-steve-kean')
    await registerSessionTenant(askerSid, askerId)
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })

    const outboundSid = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    await runWithTenantContextAsync(
      { tenantUserId: askerId, workspaceHandle: 'tl-asker', homeDir: tenantHomeDir(askerId) },
      async () => {
        const { ensureSessionStub, appendTurn } = await import('@server/lib/chat/chatStorage.js')
        await ensureSessionStub(outboundSid, {
          sessionType: 'b2b_outbound',
          remoteGrantId: grant.id,
          remoteHandle: 'tl-owner',
          remoteDisplayName: 'Owner',
        })
        await appendTurn({
          sessionId: outboundSid,
          userMessage: 'My outbound question',
          assistantMessage: {
            role: 'assistant',
            content: 'Their brain reply',
            parts: [{ type: 'text', content: 'Their brain reply' }],
          },
        })
      },
    )

    const inboundId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'tl-owner', homeDir: tenantHomeDir(ownerId) },
      async () => {
        const { ensureSessionStub, appendTurn } = await import('@server/lib/chat/chatStorage.js')
        await ensureSessionStub(inboundId, {
          sessionType: 'b2b_inbound',
          remoteGrantId: grant.id,
          remoteHandle: 'tl-asker',
          remoteDisplayName: 'Asker',
          approvalState: 'pending',
        })
        await appendTurn({
          sessionId: inboundId,
          userMessage: 'Peer asks this',
          assistantMessage: {
            role: 'assistant',
            content: 'Draft',
            parts: [{ type: 'text', content: 'Draft' }],
          },
        })
      },
    )

    const app = mountB2BChat()
    const askerTl = await app.request(
      `http://localhost/api/chat/b2b/tunnel-timeline/${encodeURIComponent('demo-ken-lay')}`,
      { headers: { cookie: `brain_session=${askerSid}` } },
    )
    expect(askerTl.status).toBe(200)
    const askerJson = (await askerTl.json()) as {
      timeline: Array<{ kind: string; actor?: string; body?: string; hint?: string }>
    }
    const outboundUser = askerJson.timeline.find(
      (e) => e.kind === 'message' && e.body === 'My outbound question',
    )
    expect(outboundUser?.actor).toBe('you')
    expect(outboundUser?.hint).toBe('to_their_brain')
    const outboundAssist = askerJson.timeline.find(
      (e) => e.kind === 'message' && e.body === 'Their brain reply',
    )
    expect(outboundAssist?.actor).toBe('their_brain')

    const ownerTl = await app.request(
      `http://localhost/api/chat/b2b/tunnel-timeline/${encodeURIComponent('demo-steve-kean')}`,
      { headers: { cookie: `brain_session=${ownerSid}` } },
    )
    expect(ownerTl.status).toBe(200)
    const ownerJson = (await ownerTl.json()) as {
      timeline: Array<{ kind: string; actor?: string; body?: string }>
      inboundPrivacyPolicy?: string | null
    }
    expect(ownerJson.inboundPrivacyPolicy).toBe('Limited.')
    const inboundQ = ownerJson.timeline.find((e) => e.kind === 'message' && e.body === 'Peer asks this')
    expect(inboundQ?.actor).toBe('them')
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

  it('POST /withdraw-as-asker with sessionId revokes grant and deletes outbound session', async () => {
    const ownerId = 'usr_m1111111111111111111'
    const askerId = 'usr_m2222222222222222222'
    await sessionFor(ownerId, 'wd-owner')
    const askerSid = await sessionFor(askerId, 'wd-asker')
    await registerSessionTenant(askerSid, askerId)
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })

    const app = mountB2BChat()
    const ensureRes = await app.request('http://localhost/api/chat/b2b/ensure-session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ grantId: grant.id }),
    })
    expect(ensureRes.status).toBe(200)
    const { sessionId: outboundSid } = (await ensureRes.json()) as { sessionId: string }

    const withdrawRes = await app.request('http://localhost/api/chat/b2b/withdraw-as-asker', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ sessionId: outboundSid }),
    })
    expect(withdrawRes.status).toBe(200)
    expect(((await withdrawRes.json()) as { ok?: boolean }).ok).toBe(true)

    expect(getBrainQueryGrantById(grant.id)).toBeNull()

    await runWithTenantContextAsync(
      { tenantUserId: askerId, workspaceHandle: 'wd-asker', homeDir: tenantHomeDir(askerId) },
      async () => {
        expect(await loadSession(outboundSid)).toBeNull()
      },
    )

    const tunnelsRes = await app.request('http://localhost/api/chat/b2b/tunnels', {
      headers: { cookie: `brain_session=${askerSid}` },
    })
    expect(tunnelsRes.status).toBe(200)
    const tunnelsBody = (await tunnelsRes.json()) as { tunnels: Array<{ grantId?: string; outboundGrantId?: string | null }> }
    expect(tunnelsBody.tunnels.some((t) => (t.outboundGrantId ?? t.grantId) === grant.id)).toBe(false)
  })

  it('POST /withdraw-as-asker removes inbound review rows on the owner tenant when revoking established grant', async () => {
    const ownerId = 'usr_own_inb_rm_1111111111111111111'
    const askerId = 'usr_ask_inb_rm_2222222222222222222'
    await sessionFor(ownerId, 'inb-owner')
    const askerSid = await sessionFor(askerId, 'inb-asker')
    await registerSessionTenant(askerSid, askerId)
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })

    const inboundSid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'inb-owner', homeDir: tenantHomeDir(ownerId) },
      async () => {
        await ensureSessionStub(inboundSid, {
          sessionType: 'b2b_inbound',
          remoteGrantId: grant.id,
          remoteHandle: 'inb-asker',
          remoteDisplayName: 'Asker Display',
          approvalState: 'pending',
        })
        expect(listInboundSessionIdsForRemoteGrant(grant.id)).toContain(inboundSid)
      },
    )

    const app = mountB2BChat()
    const ensureRes = await app.request('http://localhost/api/chat/b2b/ensure-session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ grantId: grant.id }),
    })
    expect(ensureRes.status).toBe(200)
    const { sessionId: outboundSid } = (await ensureRes.json()) as { sessionId: string }

    const withdrawRes = await app.request('http://localhost/api/chat/b2b/withdraw-as-asker', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ sessionId: outboundSid }),
    })
    expect(withdrawRes.status).toBe(200)

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'inb-owner', homeDir: tenantHomeDir(ownerId) },
      async () => {
        expect(await loadSession(inboundSid)).toBeNull()
        expect(listInboundSessionIdsForRemoteGrant(grant.id)).toEqual([])
      },
    )
  })

  it('POST /withdraw-as-asker with grantId clears owner inbound even when outbound row is absent', async () => {
    const ownerId = 'usr_own_gid_inb_3333333333333333333'
    const askerId = 'usr_ask_gid_inb_4444444444444444444'
    await sessionFor(ownerId, 'gid-inb-owner')
    const askerSid = await sessionFor(askerId, 'gid-inb-asker')
    await registerSessionTenant(askerSid, askerId)
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })
    const inboundSid = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'gid-inb-owner', homeDir: tenantHomeDir(ownerId) },
      async () => {
        await ensureSessionStub(inboundSid, {
          sessionType: 'b2b_inbound',
          remoteGrantId: grant.id,
          remoteHandle: 'gid-inb-asker',
          remoteDisplayName: 'Asker Two',
          approvalState: 'pending',
        })
      },
    )

    const app = mountB2BChat()
    const withdrawRes = await app.request('http://localhost/api/chat/b2b/withdraw-as-asker', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ grantId: grant.id }),
    })
    expect(withdrawRes.status).toBe(200)
    expect(getBrainQueryGrantById(grant.id)).toBeNull()

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'gid-inb-owner', homeDir: tenantHomeDir(ownerId) },
      async () => {
        expect(await loadSession(inboundSid)).toBeNull()
      },
    )
  })

  it('POST /withdraw-as-asker with grantId revokes when no session row exists', async () => {
    const ownerId = 'usr_n3333333333333333333'
    const askerId = 'usr_n4444444444444444444'
    await sessionFor(ownerId, 'wd2-owner')
    const askerSid = await sessionFor(askerId, 'wd2-asker')
    await registerSessionTenant(askerSid, askerId)
    const grant = createBrainQueryGrant({ ownerId, askerId, privacyPolicy: 'Limited.' })

    const app = mountB2BChat()
    const withdrawRes = await app.request('http://localhost/api/chat/b2b/withdraw-as-asker', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ grantId: grant.id }),
    })
    expect(withdrawRes.status).toBe(200)
    expect(getBrainQueryGrantById(grant.id)).toBeNull()
  })

  it('POST /withdraw-as-asker rejects both sessionId and grantId', async () => {
    const askerId = 'usr_x5555555555555555555'
    const askerSid = await sessionFor(askerId, 'wd3-asker')
    await registerSessionTenant(askerSid, askerId)
    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/withdraw-as-asker', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', grantId: 'bqg_x' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /withdraw-as-asker with cold outbound removes peer inbound and outbound', async () => {
    const ownerId = 'usr_coldowner11111111111'
    const askerId = 'usr_coldasker11111111111'
    await sessionFor(ownerId, 'wd-cold-owner')
    const askerSid = await sessionFor(askerId, 'wd-cold-asker')
    await registerSessionTenant(askerSid, askerId)
    const app = mountB2BChat()

    const coldRes = await app.request('http://localhost/api/chat/b2b/cold-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ targetUserId: ownerId, message: 'Withdraw me' }),
    })
    expect(coldRes.status).toBe(200)
    const j = (await coldRes.json()) as { sessionId: string; inboundSessionId: string }

    const withdrawRes = await app.request('http://localhost/api/chat/b2b/withdraw-as-asker', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ sessionId: j.sessionId }),
    })
    expect(withdrawRes.status).toBe(200)

    const ownerHome = tenantHomeDir(ownerId)
    const askerHome = tenantHomeDir(askerId)
    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'wd-cold-owner', homeDir: ownerHome },
      async () => {
        expect(await loadSession(j.inboundSessionId)).toBeNull()
      },
    )
    await runWithTenantContextAsync(
      { tenantUserId: askerId, workspaceHandle: 'wd-cold-asker', homeDir: askerHome },
      async () => {
        expect(await loadSession(j.sessionId)).toBeNull()
      },
    )
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
    expect(text).toContain('"b2bDelivery":"awaiting_peer_review"')
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

    vi.mocked(b2bAgent.createB2BAgent).mockClear()
    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'owner-multi', homeDir: tenantHomeDir(ownerId) },
      async () => {
        await runB2BQueryForGrant({ ...base, message: 'Third question' })
      },
    )
    const calls = vi.mocked(b2bAgent.createB2BAgent).mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const lastOpts = calls[calls.length - 1]![2] as { initialMessages?: { content?: { text?: string }[] }[] }
    expect(lastOpts?.initialMessages?.length).toBeGreaterThan(0)
    expect(JSON.stringify(lastOpts.initialMessages)).toContain('First question')
    expect(JSON.stringify(lastOpts.initialMessages)).toContain('Second question')
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

  it('POST /cold-query returns 400 when no target field', async () => {
    const askerId = 'usr_c0000000000000000000'
    const askerSid = await sessionFor(askerId, 'cold-req-ask')
    await registerSessionTenant(askerSid, askerId)
    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/cold-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ message: 'only message' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /cold-query returns 400 when multiple target fields', async () => {
    const askerId = 'usr_d0000000000000000000'
    const askerSid = await sessionFor(askerId, 'cold-amb-ask')
    await registerSessionTenant(askerSid, askerId)
    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/cold-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ targetHandle: 'a', targetUserId: 'usr_e0000000000000000000', message: 'm' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /cold-query succeeds with targetUserId', async () => {
    const ownerId = 'usr_a0000000000000000000'
    const askerId = 'usr_b0000000000000000000'
    await sessionFor(ownerId, 'cold-owner-u')
    const askerSid = await sessionFor(askerId, 'cold-asker-u')
    await registerSessionTenant(askerSid, askerId)
    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/cold-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ targetUserId: ownerId, message: 'Cold hello' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { sessionId?: string }
    expect(j.sessionId).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('GET /tunnels lists cold inbound asker peer for recipient (no grants)', async () => {
    const ownerId = 'usr_recv0000000000000000'
    const askerId = 'usr_send1111111111111111'
    const ownerSid = await sessionFor(ownerId, 'tunnel-recv-owner')
    await registerSessionTenant(ownerSid, ownerId)
    const askerSid = await sessionFor(askerId, 'tunnel-send-asker')
    await registerSessionTenant(askerSid, askerId)
    const app = mountB2BChat()

    const coldRes = await app.request('http://localhost/api/chat/b2b/cold-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({
        targetUserId: ownerId,
        message: 'Question from collaborator',
      }),
    })
    expect(coldRes.status).toBe(200)

    const tunnelsRes = await app.request('http://localhost/api/chat/b2b/tunnels', {
      headers: { cookie: `brain_session=${ownerSid}` },
    })
    expect(tunnelsRes.status).toBe(200)
    const tunnelsBody = (await tunnelsRes.json()) as {
      tunnels: Array<{
        peerHandle?: string
        outboundGrantId?: string | null
        inboundGrantId?: string | null
        pendingReviewCount?: number
      }>
    }
    expect(tunnelsBody.tunnels.some((t) => t.peerHandle === 'tunnel-send-asker')).toBe(true)
    const row = tunnelsBody.tunnels.find((t) => t.peerHandle === 'tunnel-send-asker')
    expect(row).toEqual(
      expect.objectContaining({
        outboundGrantId: null,
        inboundGrantId: null,
        pendingReviewCount: expect.any(Number),
      }),
    )
    expect((row?.pendingReviewCount ?? 0) >= 1).toBe(true)
  })

  it('POST /cold-query does not call promptB2BAgentForText until establish-grant', async () => {
    const order: string[] = []
    vi.mocked(b2bAgent.promptB2BAgentForText).mockImplementation(async () => {
      order.push('prompt')
      return 'Mock agent answer'
    })

    const ownerId = 'usr_a0000000000000000000'
    const askerId = 'usr_b0000000000000000000'
    const ownerSid = await sessionFor(ownerId, 'cold-owner-async')
    const askerSid = await sessionFor(askerId, 'cold-asker-async')
    await registerSessionTenant(askerSid, askerId)
    await registerSessionTenant(ownerSid, ownerId)
    const app = mountB2BChat()

    const res = await app.request('http://localhost/api/chat/b2b/cold-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ targetUserId: ownerId, message: 'Async hi' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { sessionId?: string; inboundSessionId?: string }
    expect(j.sessionId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(j.inboundSessionId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(order).toEqual([])

    const inboundId = j.inboundSessionId!
    const ownerHome = tenantHomeDir(ownerId)
    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'cold-owner-async', homeDir: ownerHome },
      async () => {
        const doc = await loadSession(inboundId)
        expect(doc).toBeTruthy()
        const assistants = doc!.messages.filter((m) => m.role === 'assistant')
        expect(assistants).toHaveLength(1)
        expect(assistants[0].content).toBe(B2B_INBOUND_COLD_QUERY_DRAFTING_TEXT)
      },
    )

    const est = await app.request('http://localhost/api/chat/b2b/establish-grant', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${ownerSid}`,
      },
      body: JSON.stringify({
        sessionId: inboundId,
        privacyPolicy: 'ALLOWED: Work topics only.\n\nOMIT: Personal life.',
      }),
    })
    expect(est.status).toBe(200)
    const estBody = (await est.json()) as { ok?: boolean; grantId?: string }
    expect(estBody.ok).toBe(true)
    expect(estBody.grantId).toMatch(/^bqg_/)

    await vi.waitFor(
      () => {
        expect(order).toEqual(['prompt'])
      },
      { timeout: 3000 },
    )

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'cold-owner-async', homeDir: ownerHome },
      async () => {
        const doc = await loadSession(inboundId)
        const assistants = doc!.messages.filter((m) => m.role === 'assistant')
        expect(assistants).toHaveLength(1)
        expect(assistants[0].content).toBe('Mock agent answer')
      },
    )

    vi.mocked(b2bAgent.promptB2BAgentForText).mockImplementation(async () => 'Mock agent answer')
  })

  it('POST /cold-query second request supersedes pending pair and returns 200', async () => {
    const ownerId = 'usr_c1111111111111111111'
    const askerId = 'usr_d1111111111111111111'
    await sessionFor(ownerId, 'cold-sup-owner')
    const askerSid = await sessionFor(askerId, 'cold-sup-asker')
    await registerSessionTenant(askerSid, askerId)
    const app = mountB2BChat()

    const res1 = await app.request('http://localhost/api/chat/b2b/cold-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ targetUserId: ownerId, message: 'First' }),
    })
    expect(res1.status).toBe(200)
    const j1 = (await res1.json()) as { sessionId: string; inboundSessionId: string }

    const res2 = await app.request('http://localhost/api/chat/b2b/cold-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ targetUserId: ownerId, message: 'Second' }),
    })
    expect(res2.status).toBe(200)
    const j2 = (await res2.json()) as { sessionId: string; inboundSessionId: string }
    expect(j2.sessionId).not.toBe(j1.sessionId)
    expect(j2.inboundSessionId).not.toBe(j1.inboundSessionId)

    const ownerHome = tenantHomeDir(ownerId)
    const askerHome = tenantHomeDir(askerId)
    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'cold-sup-owner', homeDir: ownerHome },
      async () => {
        expect(await loadSession(j1.inboundSessionId)).toBeNull()
        expect(await loadSession(j2.inboundSessionId)).toBeTruthy()
      },
    )
    await runWithTenantContextAsync(
      { tenantUserId: askerId, workspaceHandle: 'cold-sup-asker', homeDir: askerHome },
      async () => {
        expect(await loadSession(j1.sessionId)).toBeNull()
        expect(await loadSession(j2.sessionId)).toBeTruthy()
      },
    )
  })

  it('POST /cold-query clears orphaned global rate row when tenant has no cold tunnel', async () => {
    const ownerId = 'usr_e1111111111111111111'
    const askerId = 'usr_f1111111111111111111'
    await sessionFor(ownerId, 'cold-orph-owner')
    const askerSid = await sessionFor(askerId, 'cold-orph-asker')
    await registerSessionTenant(askerSid, askerId)
    recordColdQuerySent({
      senderHandle: 'cold-orph-asker',
      receiverHandle: 'cold-orph-owner',
      nowMs: Date.now(),
    })
    const app = mountB2BChat()
    const res = await app.request('http://localhost/api/chat/b2b/cold-query', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `brain_session=${askerSid}`,
      },
      body: JSON.stringify({ targetUserId: ownerId, message: 'After orphan rate row' }),
    })
    expect(res.status).toBe(200)
  })
})
