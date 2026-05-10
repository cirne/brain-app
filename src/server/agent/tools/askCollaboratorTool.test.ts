import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Stable fake ripmail home for unit tests (no filesystem required — mocks own I/O). */
const mockRipmailHome = vi.hoisted(() => ({
  path: '/tmp/brain-ask-collaborator-tool-test-ripmail',
}))

vi.mock('@server/lib/platform/brainHome.js', async (importOriginal) => {
  const a = await importOriginal<typeof import('@server/lib/platform/brainHome.js')>()
  return {
    ...a,
    ripmailHomeForBrain: () => mockRipmailHome.path,
  }
})

const {
  mockGetBrainQueryGrantById,
  mockGetPrimaryEmail,
  mockDraftNew,
  mockSend,
  mockTryGetTenantContext,
} = vi.hoisted(() => ({
  mockGetBrainQueryGrantById: vi.fn(),
  mockGetPrimaryEmail: vi.fn(),
  mockDraftNew: vi.fn(async () => ({
    id: 'dr_1',
    subject: '[braintunnel] What is the status?',
    body: 'What is the status?',
    to: ['owner@test.dev'],
    createdAt: '',
    updatedAt: '',
  })),
  mockSend: vi.fn().mockResolvedValue({ ok: true, draftId: 'dr_1', dryRun: false }),
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

vi.mock('@server/ripmail/index.js', async (importOriginal) => {
  const a = await importOriginal<typeof import('@server/ripmail/index.js')>()
  return {
    ...a,
    ripmailDraftNew: mockDraftNew,
    ripmailSend: mockSend,
  }
})

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
    mockDraftNew.mockResolvedValue({
      id: 'dr_1',
      subject: '[braintunnel] What is the status?',
      body: 'What is the status?',
      to: ['owner@test.dev'],
      createdAt: '',
      updatedAt: '',
    })
    mockSend.mockResolvedValue({ ok: true, draftId: 'dr_1', dryRun: false })
  })

  it('drafts and sends for the grant asker', async () => {
    const tool = askCollaboratorToolForTest()
    const r = await tool.execute('t1', {
      grant_id: 'bqg_0123456789abcdef01234567',
      question: 'What is the status?',
    })
    expect(mockDraftNew).toHaveBeenCalledTimes(1)
    expect(mockDraftNew).toHaveBeenCalledWith(
      mockRipmailHome.path,
      expect.objectContaining({
        to: 'owner@test.dev',
        subject: expect.stringContaining('[braintunnel]'),
        body: 'What is the status?',
      }),
    )
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(mockRipmailHome.path, 'dr_1', { dryRun: false })
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
