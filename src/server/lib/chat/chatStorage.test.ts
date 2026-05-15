import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { createBrainQueryGrant } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { createBrainQueryCustomPolicy } from '@server/lib/brainQuery/brainQueryCustomPoliciesRepo.js'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'chat-storage-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  closeTenantDbForTests()
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('chatStorage', () => {
  it('listSessions returns empty when dir has no files', async () => {
    const { listSessions } = await import('@server/lib/chat/chatStorage.js')
    const list = await listSessions()
    expect(list).toEqual([])
  })

  it('appendTurn creates file and loadSession round-trips', async () => {
    const { appendTurn, loadSession, findFilenameForSession } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = '550e8400-e29b-41d4-a716-446655440000'
    await appendTurn({
      sessionId,
      userMessage: 'hi',
      assistantMessage: { id: 'asst-yo', role: 'assistant', content: '', parts: [{ type: 'text', content: 'yo' }] },
      title: 'Test title',
    })
    const name = await findFilenameForSession(sessionId)
    expect(name).toBeTruthy()
    const doc = await loadSession(sessionId)
    expect(doc?.sessionId).toBe(sessionId)
    expect(doc?.title).toBe('Test title')
    expect(doc?.messages).toHaveLength(2)
    expect(doc?.messages[0]).toEqual(expect.objectContaining({ role: 'user', content: 'hi' }))
    expect(typeof doc?.messages[0].id).toBe('string')
  })

  it('appendTurn appends to existing file', async () => {
    const { appendTurn, loadSession } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = '660e8400-e29b-41d4-a716-446655440001'
    await appendTurn({
      sessionId,
      userMessage: 'a',
      assistantMessage: { id: 'asst-A', role: 'assistant', content: '', parts: [{ type: 'text', content: 'A' }] },
    })
    await appendTurn({
      sessionId,
      userMessage: 'b',
      assistantMessage: { id: 'asst-B', role: 'assistant', content: '', parts: [{ type: 'text', content: 'B' }] },
    })
    const doc = await loadSession(sessionId)
    expect(doc?.messages).toHaveLength(4)
    expect(doc?.messages[2]).toEqual(expect.objectContaining({ role: 'user', content: 'b' }))
    expect(typeof doc?.messages[2].id).toBe('string')
  })

  it('listSessions returns metadata sorted newest first', async () => {
    const { appendTurn, listSessions } = await import('@server/lib/chat/chatStorage.js')
    const s1 = '770e8400-e29b-41d4-a716-446655440002'
    const s2 = '880e8400-e29b-41d4-a716-446655440003'
    await appendTurn({
      sessionId: s1,
      userMessage: 'old',
      assistantMessage: { id: 'asst-1', role: 'assistant', content: '', parts: [{ type: 'text', content: '1' }] },
    })
    await new Promise(r => setTimeout(r, 5))
    await appendTurn({
      sessionId: s2,
      userMessage: 'new',
      assistantMessage: { id: 'asst-2', role: 'assistant', content: '', parts: [{ type: 'text', content: '2' }] },
    })
    const list = await listSessions()
    expect(list.map(x => x.sessionId)).toEqual([s2, s1])
    expect(list[0].preview).toContain('new')

    const capped = await listSessions(1)
    expect(capped).toHaveLength(1)
    expect(capped[0].sessionId).toBe(s2)
  })

  it('deleteSessionFile removes file', async () => {
    const { appendTurn, loadSession, deleteSessionFile } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = '990e8400-e29b-41d4-a716-446655440004'
    await appendTurn({
      sessionId,
      userMessage: 'x',
      assistantMessage: { id: 'asst-empty', role: 'assistant', content: '' },
    })
    expect(await loadSession(sessionId)).toBeTruthy()
    const ok = await deleteSessionFile(sessionId)
    expect(ok).toBe(true)
    expect(await loadSession(sessionId)).toBeNull()
  })

  it('ensureSessionStub creates empty session listed by listSessions', async () => {
    const { ensureSessionStub, listSessions, loadSession } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'bb0e8400-e29b-41d4-a716-446655440006'
    await ensureSessionStub(sessionId)
    const list = await listSessions()
    expect(list).toHaveLength(1)
    expect(list[0].sessionId).toBe(sessionId)
    expect(list[0].title).toBeNull()
    const doc = await loadSession(sessionId)
    expect(doc?.messages).toEqual([])
  })

  it('ensureSessionStub stores b2b session metadata', async () => {
    const { ensureSessionStub, listSessions, loadSession } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'bb1e8400-e29b-41d4-a716-446655440006'
    await ensureSessionStub(sessionId, {
      sessionType: 'b2b_outbound',
      remoteGrantId: 'bqg_kean_lay',
      remoteHandle: 'demo-ken-lay',
      remoteDisplayName: 'Kenneth Lay',
    })

    const list = await listSessions()
    expect(list[0]).toEqual(
      expect.objectContaining({
        sessionId,
        sessionType: 'b2b_outbound',
        remoteGrantId: 'bqg_kean_lay',
        remoteHandle: 'demo-ken-lay',
        remoteDisplayName: 'Kenneth Lay',
        approvalState: null,
      }),
    )

    const doc = await loadSession(sessionId)
    expect(doc).toEqual(
      expect.objectContaining({
        sessionId,
        sessionType: 'b2b_outbound',
        remoteGrantId: 'bqg_kean_lay',
        remoteHandle: 'demo-ken-lay',
      }),
    )
  })

  it('findB2BSession enforces one session per tunnel', async () => {
    const { ensureSessionStub, findB2BSession, listSessions } = await import('@server/lib/chat/chatStorage.js')
    await ensureSessionStub('bb2e8400-e29b-41d4-a716-446655440006', {
      sessionType: 'b2b_outbound',
      remoteGrantId: 'bqg_once',
      remoteHandle: 'demo-ken-lay',
      remoteDisplayName: 'Kenneth Lay',
    })

    await expect(
      ensureSessionStub('bb3e8400-e29b-41d4-a716-446655440006', {
        sessionType: 'b2b_outbound',
        remoteGrantId: 'bqg_once',
        remoteHandle: 'demo-ken-lay',
        remoteDisplayName: 'Kenneth Lay',
      }),
    ).rejects.toThrow()

    expect(await findB2BSession('bqg_once', 'b2b_outbound')).toEqual(
      expect.objectContaining({ sessionId: 'bb2e8400-e29b-41d4-a716-446655440006' }),
    )
    expect(await listSessions()).toHaveLength(1)
  })

  it('updateApprovalState updates inbound approval state', async () => {
    const { ensureSessionStub, listSessions, updateApprovalState } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'bb4e8400-e29b-41d4-a716-446655440006'
    await ensureSessionStub(sessionId, {
      sessionType: 'b2b_inbound',
      remoteGrantId: 'bqg_pending',
      remoteHandle: 'demo-steve-kean',
      remoteDisplayName: 'Steven Kean',
      approvalState: 'pending',
    })

    expect(await updateApprovalState(sessionId, 'approved')).toBe(true)
    expect((await listSessions())[0]).toEqual(
      expect.objectContaining({
        sessionType: 'b2b_inbound',
        approvalState: 'approved',
      }),
    )
  })

  it('listPendingColdInboundPairsForPeerAsker and listColdOutboundSessionIdsForPeer', async () => {
    const {
      ensureSessionStub,
      listPendingColdInboundPairsForPeerAsker,
      listColdOutboundSessionIdsForPeer,
      updateApprovalState,
    } = await import('@server/lib/chat/chatStorage.js')
    const asker = 'usr_aaaaaaaaaaaaaaaaaaaa'
    const ownerPeer = 'usr_bbbbbbbbbbbbbbbbbbbb'
    const outbound = 'dd0e8400-e29b-41d4-a716-446655440010'
    const inbound = 'dd1e8400-e29b-41d4-a716-446655440011'
    await ensureSessionStub(outbound, {
      sessionType: 'b2b_outbound',
      remoteGrantId: null,
      isColdQuery: true,
      coldPeerUserId: ownerPeer,
      coldLinkedSessionId: inbound,
      remoteHandle: 'peer',
      remoteDisplayName: 'Peer',
    })
    await ensureSessionStub(inbound, {
      sessionType: 'b2b_inbound',
      remoteGrantId: null,
      isColdQuery: true,
      coldPeerUserId: asker,
      coldLinkedSessionId: outbound,
      remoteHandle: 'asker-h',
      remoteDisplayName: 'Asker',
      approvalState: 'pending',
    })
    expect(listPendingColdInboundPairsForPeerAsker(asker)).toEqual([
      { inboundSessionId: inbound, outboundSessionId: outbound },
    ])
    expect(listColdOutboundSessionIdsForPeer(ownerPeer)).toEqual([outbound])
    await updateApprovalState(inbound, 'dismissed')
    expect(listPendingColdInboundPairsForPeerAsker(asker)).toEqual([])
  })

  it('ensureSessionStub is idempotent', async () => {
    const { ensureSessionStub, listSessions } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'cc0e8400-e29b-41d4-a716-446655440007'
    await ensureSessionStub(sessionId)
    await ensureSessionStub(sessionId)
    expect((await listSessions())).toHaveLength(1)
  })

  it('patchSessionTitle updates title on existing session file', async () => {
    const { ensureSessionStub, patchSessionTitle, loadSession } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'dd0e8400-e29b-41d4-a716-446655440008'
    await ensureSessionStub(sessionId)
    await patchSessionTitle(sessionId, '  My title  ')
    const doc = await loadSession(sessionId)
    expect(doc?.title).toBe('My title')
  })

  it('appendTurn with userMessage null stores assistant-first turn', async () => {
    const { appendTurn, loadSession, listSessions } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'ff0e8400-e29b-41d4-a716-446655440010'
    await appendTurn({
      sessionId,
      userMessage: null,
      assistantMessage: { id: 'asst-welcome', role: 'assistant', content: '', parts: [{ type: 'text', content: 'Welcome.' }] },
    })
    const doc = await loadSession(sessionId)
    expect(doc?.messages).toHaveLength(1)
    expect(doc?.messages[0].role).toBe('assistant')
    const list = await listSessions()
    expect(list[0].preview).toContain('Welcome')
  })

  it('appendTurn merges into stub created by ensureSessionStub', async () => {
    const { ensureSessionStub, appendTurn, loadSession } = await import('@server/lib/chat/chatStorage.js')
    const sessionId = 'ee0e8400-e29b-41d4-a716-446655440009'
    await ensureSessionStub(sessionId)
    await appendTurn({
      sessionId,
      userMessage: 'hi',
      assistantMessage: { id: 'asst-merge-yo', role: 'assistant', content: '', parts: [{ type: 'text', content: 'yo' }] },
      title: 'Later',
    })
    const doc = await loadSession(sessionId)
    expect(doc?.messages).toHaveLength(2)
    expect(doc?.title).toBe('Later')
  })

  it('replaceLastAwaitingPeerReviewOutboundAssistant replaces placeholder assistant', async () => {
    const { appendTurn, loadSession, replaceLastAwaitingPeerReviewOutboundAssistant } = await import(
      '@server/lib/chat/chatStorage.js'
    )
    const sessionId = 'aa0e8400-e29b-41d4-a716-446655440088'
    const ph = 'PLACEHOLDER'
    await appendTurn({
      sessionId,
      userMessage: 'q',
      assistantMessage: {
        role: 'assistant',
        content: ph,
        parts: [{ type: 'text', content: ph }],
        b2bDelivery: 'awaiting_peer_review',
      },
    })
    expect(await replaceLastAwaitingPeerReviewOutboundAssistant({ sessionId, text: 'Final answer' })).toBe(true)
    const { listTimelineMessages } = await import('@server/lib/chat/chatStorage.js')
    const tl = listTimelineMessages(sessionId)
    expect(tl).toHaveLength(2)
    expect(tl[0]!.role).toBe('user')
    expect(tl[1]!.role).toBe('assistant')
    expect(tl[1]!.createdAtMs).toBeGreaterThanOrEqual(tl[0]!.createdAtMs)
    const doc = await loadSession(sessionId)
    expect(doc?.messages[1]?.content).toBe('Final answer')
    expect(doc?.messages[1]?.b2bDelivery).toBeUndefined()
  })

  it('listB2BInboundReviewRows filters by pending vs sent', async () => {
    closeBrainGlobalDbForTests()
    const prevG = process.env.BRAIN_GLOBAL_SQLITE_PATH
    process.env.BRAIN_GLOBAL_SQLITE_PATH = join(brainHome, 'brain-global.sqlite')
    const pendOwner = 'usr_pend111111111111111111111'
    const pendAsker = 'usr_pend222222222222222222222'
    const pendPol = createBrainQueryCustomPolicy({ ownerId: pendOwner, title: 'p', body: 'Brief.' })
    const pendGrant = createBrainQueryGrant({
      ownerId: pendOwner,
      askerId: pendAsker,
      customPolicyId: pendPol.id,
    })
    const sentOwner = 'usr_sent333333333333333333333'
    const sentAsker = 'usr_sent444444444444444444444'
    const sentPol = createBrainQueryCustomPolicy({ ownerId: sentOwner, title: 's', body: 'Brief.' })
    const sentGrant = createBrainQueryGrant({
      ownerId: sentOwner,
      askerId: sentAsker,
      customPolicyId: sentPol.id,
    })
    try {
      const { ensureSessionStub, appendTurn, listB2BInboundReviewRows } = await import('@server/lib/chat/chatStorage.js')
      const pendingId = 'p0e8400-e29b-41d4-a716-446655440080'
      await ensureSessionStub(pendingId, {
        sessionType: 'b2b_inbound',
        remoteGrantId: pendGrant.id,
        remoteHandle: 'h1',
        remoteDisplayName: 'Peer',
        approvalState: 'pending',
      })
      await appendTurn({
        sessionId: pendingId,
        userMessage: 'hello',
        assistantMessage: { role: 'assistant', content: 'draft', parts: [{ type: 'text', content: 'draft reply' }] },
      })
      const sentId = 's0e8400-e29b-41d4-a716-446655440081'
      await ensureSessionStub(sentId, {
        sessionType: 'b2b_inbound',
        remoteGrantId: sentGrant.id,
        remoteHandle: 'h2',
        approvalState: 'auto',
      })
      const pend = await listB2BInboundReviewRows({ stateFilter: 'pending' })
      expect(pend.some((r) => r.sessionId === pendingId)).toBe(true)
      expect(pend.some((r) => r.sessionId === sentId)).toBe(false)
      const sent = await listB2BInboundReviewRows({ stateFilter: 'sent' })
      expect(sent.some((r) => r.sessionId === sentId)).toBe(true)
    } finally {
      closeBrainGlobalDbForTests()
      if (prevG !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevG
      else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    }
  })

  it('listB2BInboundReviewRows drops established inbound when global grant row is gone', async () => {
    closeBrainGlobalDbForTests()
    const prevG = process.env.BRAIN_GLOBAL_SQLITE_PATH
    process.env.BRAIN_GLOBAL_SQLITE_PATH = join(brainHome, 'brain-global.sqlite')
    const goneOwner = 'usr_goneooooooooooooooooooooooo'
    const goneAsker = 'usr_goneqqqqqqqqqqqqqqqqqqqqqqqq'
    const vanPol = createBrainQueryCustomPolicy({ ownerId: goneOwner, title: 'v', body: '.' })
    const vanished = createBrainQueryGrant({
      ownerId: goneOwner,
      askerId: goneAsker,
      customPolicyId: vanPol.id,
    })
    try {
      const { ensureSessionStub, appendTurn, loadSession, listB2BInboundReviewRows } = await import(
        '@server/lib/chat/chatStorage.js'
      )
      const sid = 'f0e8400-e29b-41d4-a716-446655440082'
      await ensureSessionStub(sid, {
        sessionType: 'b2b_inbound',
        remoteGrantId: vanished.id,
        remoteHandle: '@ghost',
        remoteDisplayName: 'Ghost',
        approvalState: 'pending',
      })
      await appendTurn({
        sessionId: sid,
        userMessage: 'orphan?',
        assistantMessage: { role: 'assistant', content: 'x', parts: [{ type: 'text', content: 'x' }] },
      })
      const { revokeBrainQueryGrant } = await import('@server/lib/brainQuery/brainQueryGrantsRepo.js')
      revokeBrainQueryGrant({ grantId: vanished.id, ownerId: goneOwner })
      closeBrainGlobalDbForTests()

      const rows = await listB2BInboundReviewRows({ stateFilter: 'pending' })
      expect(rows.some((r) => r.sessionId === sid)).toBe(false)
      expect(await loadSession(sid)).toBeNull()
    } finally {
      closeBrainGlobalDbForTests()
      if (prevG !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevG
      else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    }
  })

  it('deleteAllChatSessionFiles removes chat rows only', async () => {
    const { appendTurn, listSessions, deleteAllChatSessionFiles } = await import('@server/lib/chat/chatStorage.js')
    await mkdir(join(brainHome, 'chats'), { recursive: true })
    await writeFile(join(brainHome, 'chats', 'onboarding.json'), '{"state":"done"}', 'utf-8')
    await appendTurn({
      sessionId: 'aa0e8400-e29b-41d4-a716-446655440005',
      userMessage: 'hi',
      assistantMessage: { id: 'asst-del-all-yo', role: 'assistant', content: '', parts: [{ type: 'text', content: 'yo' }] },
    })
    expect((await listSessions())).toHaveLength(1)
    await deleteAllChatSessionFiles()
    expect(await listSessions()).toEqual([])
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(join(brainHome, 'chats', 'onboarding.json'), 'utf-8')).toContain('done')
  })
})
