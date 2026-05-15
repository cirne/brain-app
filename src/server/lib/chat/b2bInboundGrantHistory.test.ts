import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { createBrainQueryGrant } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import { createBrainQueryCustomPolicy } from '@server/lib/brainQuery/brainQueryCustomPoliciesRepo.js'
import { appendTurn, ensureSessionStub } from './chatStorage.js'
import { B2B_GRANT_HISTORY_MAX_MESSAGES, loadB2BInboundGrantHistoryAgentMessages, trimAgentMessagesByTotalChars } from './b2bInboundGrantHistory.js'
import type { AgentMessage } from '@mariozechner/pi-agent-core'

describe('b2bInboundGrantHistory', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH
  let root: string

  beforeEach(async () => {
    closeTenantDbForTests()
    closeBrainGlobalDbForTests()
    root = await mkdtemp(join(tmpdir(), 'b2b-grant-hist-'))
    process.env.BRAIN_DATA_ROOT = root
    process.env.BRAIN_GLOBAL_SQLITE_PATH = join(root, '.global', 'brain-global.sqlite')
  })

  afterEach(async () => {
    closeTenantDbForTests()
    closeBrainGlobalDbForTests()
    delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    delete process.env.BRAIN_DATA_ROOT
    if (prevRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevRoot
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    await rm(root, { recursive: true, force: true })
  })

  it('loads prior inbound sessions for the grant in order, excluding one session', async () => {
    const ownerId = 'usr_hist_owner1111111111111111'
    const askerId = 'usr_hist_asker2222222222222222'
    ensureTenantHomeDir(ownerId)
    const pol = createBrainQueryCustomPolicy({ ownerId, title: 't', body: 'Test policy.' })
    const grant = createBrainQueryGrant({ ownerId, askerId, customPolicyId: pol.id })
    const inbound1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const inbound2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'hist-owner', homeDir: tenantHomeDir(ownerId) },
      async () => {
        await ensureSessionStub(inbound1, {
          sessionType: 'b2b_inbound',
          remoteGrantId: grant.id,
          remoteHandle: 'peer',
          remoteDisplayName: 'Peer',
          approvalState: 'approved',
        })
        await appendTurn({
          sessionId: inbound1,
          userMessage: 'First question',
          assistantMessage: {
            role: 'assistant',
            content: 'First answer',
            parts: [{ type: 'text', content: 'First answer' }],
          },
        })
        await ensureSessionStub(inbound2, {
          sessionType: 'b2b_inbound',
          remoteGrantId: grant.id,
          remoteHandle: 'peer',
          remoteDisplayName: 'Peer',
          approvalState: 'pending',
        })
        await appendTurn({
          sessionId: inbound2,
          userMessage: 'Second question',
          assistantMessage: {
            role: 'assistant',
            content: 'Second draft',
            parts: [{ type: 'text', content: 'Second draft' }],
          },
        })
      },
    )

    await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: 'hist-owner', homeDir: tenantHomeDir(ownerId) },
      async () => {
        const onlyFirst = await loadB2BInboundGrantHistoryAgentMessages({
          remoteGrantId: grant.id,
          excludeSessionId: inbound2,
        })
        const textFirst = JSON.stringify(onlyFirst)
        expect(textFirst).toContain('First question')
        expect(textFirst).toContain('First answer')
        expect(textFirst).not.toContain('Second question')

        const both = await loadB2BInboundGrantHistoryAgentMessages({
          remoteGrantId: grant.id,
          excludeSessionId: null,
        })
        const textBoth = JSON.stringify(both)
        expect(textBoth).toContain('First question')
        expect(textBoth).toContain('Second question')
      },
    )
  })

  it('trimAgentMessagesByTotalChars drops from the front until under budget', () => {
    const mkUser = (text: string): AgentMessage => ({
      role: 'user',
      content: [{ type: 'text' as const, text }],
      timestamp: 1,
    })
    const many = Array.from({ length: 20 }, (_, i) => mkUser(`x${String(i).padStart(20, '0')}`))
    const budget = 100
    const trimmed = trimAgentMessagesByTotalChars(many, budget)
    expect(trimmed.length).toBeLessThan(many.length)
    let total = 0
    for (const m of trimmed) {
      if (m.role === 'user' || m.role === 'assistant') {
        const c = m.content as { text?: string }[]
        for (const x of c) {
          if (typeof x.text === 'string') total += x.text.length
        }
      }
    }
    expect(total).toBeLessThanOrEqual(budget)
    expect(B2B_GRANT_HISTORY_MAX_MESSAGES).toBe(10)
  })
})
