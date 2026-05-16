import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
import { ensureTenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { ensureSessionStub, appendTurn, loadSession } from './chatStorage.js'
import { approveInboundSession, declineInboundSession } from './inboundApproval.js'
import type { MessagingAdapter } from '@server/lib/messaging/types.js'
import type { SlackSessionDelivery } from './chatTypes.js'
import { randomUUID } from 'node:crypto'

const TENANT_ID = 'usr_test_approval'

async function withTenantCtx<T>(fn: () => Promise<T>): Promise<T> {
  const homeDir = ensureTenantHomeDir(TENANT_ID)
  const meta = await readHandleMeta(homeDir)
  return runWithTenantContextAsync(
    { tenantUserId: TENANT_ID, workspaceHandle: meta?.handle ?? TENANT_ID, homeDir },
    fn,
  )
}

describe('inboundApproval', () => {
  const prevTenant = process.env.BRAIN_TENANT_SQLITE_PATH
  const prevBrainHome = process.env.BRAIN_HOME
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'inbound-approval-'))
    process.env.BRAIN_HOME = tmpDir
    process.env.BRAIN_TENANT_SQLITE_PATH = join(tmpDir, 'tenant.sqlite')
    closeTenantDbForTests()
  })

  afterEach(async () => {
    closeTenantDbForTests()
    if (prevTenant !== undefined) process.env.BRAIN_TENANT_SQLITE_PATH = prevTenant
    else delete process.env.BRAIN_TENANT_SQLITE_PATH
    if (prevBrainHome !== undefined) process.env.BRAIN_HOME = prevBrainHome
    else delete process.env.BRAIN_HOME
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function makeMockAdapter(
    spyPostFinalReply: ReturnType<typeof vi.fn>,
    spyUpdateApproval?: ReturnType<typeof vi.fn>,
  ): MessagingAdapter {
    return {
      parseEvent: vi.fn().mockReturnValue(null) as MessagingAdapter['parseEvent'],
      sendResponse: vi.fn().mockResolvedValue(undefined) as MessagingAdapter['sendResponse'],
      sendApprovalRequest: vi.fn().mockResolvedValue({ approvalMessageTs: 'ts1', approvalChannelId: 'C1' }) as MessagingAdapter['sendApprovalRequest'],
      parseInteraction: vi.fn().mockReturnValue(null) as MessagingAdapter['parseInteraction'],
      postFinalReply: spyPostFinalReply as unknown as MessagingAdapter['postFinalReply'],
      updateApprovalMessage: (spyUpdateApproval ?? vi.fn().mockResolvedValue(undefined)) as unknown as MessagingAdapter['updateApprovalMessage'],
    }
  }

  async function seedSlackSession(slackDelivery: SlackSessionDelivery, draft: string): Promise<string> {
    return withTenantCtx(async () => {
      const sessionId = randomUUID()
      await ensureSessionStub(sessionId, {
        sessionType: 'b2b_inbound',
        approvalState: 'pending',
        slackDelivery,
        remoteHandle: 'slack:U_REQ',
        remoteDisplayName: '<@U_REQ>',
      })
      await appendTurn({
        sessionId,
        userMessage: 'What does Alex think?',
        assistantMessage: { role: 'assistant', content: draft, parts: [{ type: 'text', content: draft }] },
      })
      return sessionId
    })
  }

  const slackDelivery: SlackSessionDelivery = {
    slackTeamId: 'T1',
    requesterSlackUserId: 'U_REQ',
    requesterChannelId: 'D_REQ',
    ownerSlackUserId: 'U_OWNER',
    ownerApprovalChannelId: 'D_OWNER',
    ownerApprovalMessageTs: 'ts-block-kit',
    ownerDisplayName: 'Alex',
  }

  it('approve: calls postFinalReply and updateApprovalMessage for slack session', async () => {
    const postFinalReply = vi.fn().mockResolvedValue(undefined)
    const updateApprovalMessage = vi.fn().mockResolvedValue(undefined)
    const adapter = makeMockAdapter(postFinalReply, updateApprovalMessage)
    const sessionId = await seedSlackSession(slackDelivery, 'The answer is 42.')

    await withTenantCtx(async () => {
      const result = await approveInboundSession(sessionId, TENANT_ID, { slackAdapter: adapter })
      expect('ok' in result).toBe(true)
    })

    expect(postFinalReply).toHaveBeenCalledOnce()
    const [target, text, attribution] = postFinalReply.mock.calls[0]!
    expect((target as { channelId: string }).channelId).toBe('D_REQ')
    expect(text as string).toContain('The answer is 42.')
    expect(attribution as string).toContain('Alex')
    expect(updateApprovalMessage).toHaveBeenCalledOnce()
    expect(updateApprovalMessage.mock.calls[0]![3]).toBe('approved')
  })

  it('approve: does not call appendAssistantToAsker for slack session', async () => {
    const appendSpy = vi.fn().mockResolvedValue(undefined) as ReturnType<typeof vi.fn>
    const adapter = makeMockAdapter(vi.fn().mockResolvedValue(undefined))
    const sessionId = await seedSlackSession(slackDelivery, 'Draft text.')

    await withTenantCtx(async () => {
      await approveInboundSession(sessionId, TENANT_ID, {
        slackAdapter: adapter,
        appendAssistantToAsker: appendSpy as unknown as (grantRow: unknown, draft: string, traceSessionId: string) => Promise<void>,
      })
    })
    expect(appendSpy).not.toHaveBeenCalled()
  })

  it('second approve on same session is a no-op (status guard)', async () => {
    const postFinalReply = vi.fn().mockResolvedValue(undefined)
    const adapter = makeMockAdapter(postFinalReply)
    const sessionId = await seedSlackSession(slackDelivery, 'Draft.')

    await withTenantCtx(async () => {
      const r1 = await approveInboundSession(sessionId, TENANT_ID, { slackAdapter: adapter })
      expect('ok' in r1).toBe(true)
      const r2 = await approveInboundSession(sessionId, TENANT_ID, { slackAdapter: adapter })
      expect('ok' in r2).toBe(false)
    })
    // postFinalReply only called once
    expect(postFinalReply).toHaveBeenCalledOnce()
  })

  it('decline: calls postFinalReply with decline text', async () => {
    const postFinalReply = vi.fn().mockResolvedValue(undefined)
    const adapter = makeMockAdapter(postFinalReply)
    const sessionId = await seedSlackSession(slackDelivery, 'Draft.')

    await withTenantCtx(async () => {
      const result = await declineInboundSession(sessionId, TENANT_ID, { slackAdapter: adapter })
      expect('ok' in result).toBe(true)
    })

    expect(postFinalReply).toHaveBeenCalledOnce()
    const session = await withTenantCtx(() => loadSession(sessionId))
    expect(session?.approvalState).toBe('declined')
  })
})
