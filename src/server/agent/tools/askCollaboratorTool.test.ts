import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockGetBrainQueryGrantById,
  mockGetPrimaryEmail,
  mockExec,
  mockTryGetTenantContext,
} = vi.hoisted(() => ({
  mockGetBrainQueryGrantById: vi.fn(),
  mockGetPrimaryEmail: vi.fn(),
  mockExec: vi.fn(),
  mockTryGetTenantContext: vi.fn(() => ({ tenantUserId: 'usr_asker00000000000001' })),
}))

vi.mock('@server/lib/tenant/tenantContext.js', () => ({
  tryGetTenantContext: mockTryGetTenantContext,
}))

vi.mock('@server/lib/brainQuery/brainQueryGrantsRepo.js', () => ({
  getBrainQueryGrantById: mockGetBrainQueryGrantById,
}))

vi.mock('@server/lib/tenant/workspaceHandleDirectory.js', () => ({
  getPrimaryEmailForUserId: mockGetPrimaryEmail,
}))

vi.mock('@server/lib/ripmail/ripmailRun.js', () => ({
  execRipmailAsync: mockExec,
  RIPMAIL_SEND_TIMEOUT_MS: 120000,
}))

vi.mock('@server/lib/ripmail/ripmailBin.js', () => ({
  ripmailBin: () => '/bin/ripmail',
}))

vi.mock('@server/lib/ripmail/evalRipmailSendDryRun.js', () => ({
  isEvalRipmailSendDryRun: () => false,
}))

vi.mock('@server/lib/ripmail/ripmailSourceResolve.js', () => ({
  resolveRipmailSourceForCli: vi.fn(async () => undefined),
}))

import { createAskCollaboratorTool } from './askCollaboratorTool.js'

type AskCollaboratorExecute = (
  toolCallId: string,
  params: { grant_id: string; question: string; from?: string },
) => Promise<{ content: Array<{ type: 'text'; text: string }> }>

function askCollaboratorToolForTest() {
  return createAskCollaboratorTool() as unknown as { execute: AskCollaboratorExecute }
}

describe('ask_collaborator tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTryGetTenantContext.mockReturnValue({ tenantUserId: 'usr_asker00000000000001' })
    mockGetBrainQueryGrantById.mockReturnValue({
      id: 'bqg_0123456789abcdef01234567',
      owner_id: 'usr_owner00000000000002',
      asker_id: 'usr_asker00000000000001',
      privacy_policy: '',
      created_at_ms: 0,
      updated_at_ms: 0,
      revoked_at_ms: null,
    })
    mockGetPrimaryEmail.mockResolvedValue('owner@test.dev')
    mockExec
      .mockResolvedValueOnce({ stdout: JSON.stringify({ id: 'dr_1', subject: '[braintunnel] Hello' }) })
      .mockResolvedValueOnce({ stdout: '' })
  })

  it('drafts and sends for the grant asker', async () => {
    const tool = askCollaboratorToolForTest()
    const r = await tool.execute('t1', {
      grant_id: 'bqg_0123456789abcdef01234567',
      question: 'What is the status?',
    })
    expect(mockExec).toHaveBeenCalledTimes(2)
    const first = mockExec.mock.calls[0]?.[0] as string
    expect(first).toContain('draft new')
    expect(first).toContain('owner@test.dev')
    const second = mockExec.mock.calls[1]?.[0] as string
    expect(second).toContain('send')
    expect(second).toContain('dr_1')
    expect(r.content[0]?.text).toContain('Question sent')
  })

  it('rejects without tenant context', async () => {
    mockTryGetTenantContext.mockReturnValue(undefined as never)
    const tool = askCollaboratorToolForTest()
    await expect(
      tool.execute('t1', { grant_id: 'bqg_0123456789abcdef01234567', question: 'Hi' }),
    ).rejects.toThrow('authenticated workspace')
  })

  it('rejects wrong tenant', async () => {
    mockGetBrainQueryGrantById.mockReturnValue({
      id: 'bqg_0123456789abcdef01234567',
      owner_id: 'usr_owner00000000000002',
      asker_id: 'usr_other00000000000009',
      privacy_policy: '',
      created_at_ms: 0,
      updated_at_ms: 0,
      revoked_at_ms: null,
    })
    const tool = askCollaboratorToolForTest()
    await expect(
      tool.execute('t1', { grant_id: 'bqg_0123456789abcdef01234567', question: 'Hi' }),
    ).rejects.toThrow('not yours')
  })

  it('rejects revoked grant', async () => {
    mockGetBrainQueryGrantById.mockReturnValue({
      id: 'bqg_0123456789abcdef01234567',
      owner_id: 'usr_owner00000000000002',
      asker_id: 'usr_asker00000000000001',
      privacy_policy: '',
      created_at_ms: 0,
      updated_at_ms: 0,
      revoked_at_ms: 1,
    })
    const tool = askCollaboratorToolForTest()
    await expect(
      tool.execute('t1', { grant_id: 'bqg_0123456789abcdef01234567', question: 'Hi' }),
    ).rejects.toThrow('revoked')
  })

  it('rejects missing grant', async () => {
    mockGetBrainQueryGrantById.mockReturnValue(null)
    const tool = askCollaboratorToolForTest()
    await expect(
      tool.execute('t1', { grant_id: 'bqg_0123456789abcdef01234567', question: 'Hi' }),
    ).rejects.toThrow('not found')
  })

  it('rejects missing owner mailbox', async () => {
    mockGetPrimaryEmail.mockResolvedValue(null)
    const tool = askCollaboratorToolForTest()
    await expect(
      tool.execute('t1', { grant_id: 'bqg_0123456789abcdef01234567', question: 'Hi' }),
    ).rejects.toThrow('mailbox')
  })
})
