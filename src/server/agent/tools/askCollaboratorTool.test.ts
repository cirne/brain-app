import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockGetBrainQueryGrantById,
  mockGetActiveBrainQueryGrant,
  mockResolveConfirmedHandle,
  mockGetPrimaryEmail,
  mockCreateNotificationForTenant,
  mockReadHandleMeta,
  mockTryGetTenantContext,
} = vi.hoisted(() => ({
  mockGetBrainQueryGrantById: vi.fn(),
  mockGetActiveBrainQueryGrant: vi.fn(),
  mockResolveConfirmedHandle: vi.fn(),
  mockGetPrimaryEmail: vi.fn(),
  mockCreateNotificationForTenant: vi.fn().mockResolvedValue({ id: 'nid-1' }),
  mockReadHandleMeta: vi.fn().mockResolvedValue({
    userId: 'usr_asker00000000000001',
    handle: 'pat',
    confirmedAt: '2026-01-01T00:00:00.000Z',
  }),
  mockTryGetTenantContext: vi.fn(() => ({ tenantUserId: 'usr_asker00000000000001' })),
}))

vi.mock('@server/lib/tenant/tenantContext.js', () => ({
  tryGetTenantContext: mockTryGetTenantContext,
}))

vi.mock('@server/lib/brainQuery/brainQueryGrantsRepo.js', () => ({
  getBrainQueryGrantById: mockGetBrainQueryGrantById,
  getActiveBrainQueryGrant: mockGetActiveBrainQueryGrant,
}))

vi.mock('@server/lib/tenant/workspaceHandleDirectory.js', () => ({
  getPrimaryEmailForUserId: mockGetPrimaryEmail,
  resolveConfirmedHandle: mockResolveConfirmedHandle,
}))

vi.mock('@server/lib/notifications/createNotificationForTenant.js', () => ({
  createNotificationForTenant: mockCreateNotificationForTenant,
}))

vi.mock('@server/lib/tenant/handleMeta.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/lib/tenant/handleMeta.js')>()
  return {
    ...actual,
    readHandleMeta: mockReadHandleMeta,
  }
})

vi.mock('@server/lib/tenant/dataRoot.js', () => ({
  tenantHomeDir: (id: string) => `/tmp/brain-test-home/${id}`,
}))

import { createAskCollaboratorTool } from './askCollaboratorTool.js'

type AskCollaboratorExecute = (
  toolCallId: string,
  params: {
    grant_id?: string
    peer_handle?: string
    peer_user_id?: string
    question: string
  },
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
      auto_send: 0,
      created_at_ms: 0,
      updated_at_ms: 0,
      revoked_at_ms: null,
    })
    mockGetPrimaryEmail.mockResolvedValue('asker@test.dev')
    mockReadHandleMeta.mockResolvedValue({
      userId: 'usr_asker00000000000001',
      handle: 'pat',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    mockCreateNotificationForTenant.mockResolvedValue({ id: 'nid-1' })
    mockGetActiveBrainQueryGrant.mockReturnValue(null)
    mockResolveConfirmedHandle.mockResolvedValue(null)
  })

  it('creates brain_query_question on the grant owner tenant', async () => {
    const tool = askCollaboratorToolForTest()
    const r = await tool.execute('t1', {
      grant_id: 'bqg_0123456789abcdef01234567',
      question: 'What is the status?',
    })
    expect(mockCreateNotificationForTenant).toHaveBeenCalledTimes(1)
    expect(mockCreateNotificationForTenant).toHaveBeenCalledWith('usr_owner00000000000002', {
      sourceKind: 'brain_query_question',
      payload: expect.objectContaining({
        grantId: 'bqg_0123456789abcdef01234567',
        peerUserId: 'usr_asker00000000000001',
        peerPrimaryEmail: 'asker@test.dev',
        peerHandle: 'pat',
        question: 'What is the status?',
        subject: 'What is the status?',
      }),
    })
    expect(r.content[0]?.text).toContain('Braintunnel notifications')
    expect(r.content[0]?.text).not.toContain('[dry run')
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
      auto_send: 0,
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
      auto_send: 0,
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

  it('rejects missing asker primary mailbox', async () => {
    mockGetPrimaryEmail.mockResolvedValue(null)
    const tool = askCollaboratorToolForTest()
    await expect(
      tool.execute('t1', { grant_id: 'bqg_0123456789abcdef01234567', question: 'Hi' }),
    ).rejects.toThrow('primary mailbox')
  })

  it('omits peerHandle when handle not confirmed', async () => {
    mockReadHandleMeta.mockResolvedValue({ userId: 'usr_asker00000000000001' })
    const tool = askCollaboratorToolForTest()
    await tool.execute('t1', {
      grant_id: 'bqg_0123456789abcdef01234567',
      question: 'Yo',
    })
    const [, arg] = mockCreateNotificationForTenant.mock.calls[0]!
    expect(arg.payload).not.toHaveProperty('peerHandle')
  })

  it('resolves grant via peer_handle when grant_id omitted', async () => {
    mockGetBrainQueryGrantById.mockReturnValue(null)
    mockResolveConfirmedHandle.mockResolvedValue({
      userId: 'usr_owner00000000000002',
      handle: 'cirne',
      primaryEmail: 'c@test.dev',
    })
    mockGetActiveBrainQueryGrant.mockReturnValue({
      id: 'bqg_0123456789abcdef01234567',
      owner_id: 'usr_owner00000000000002',
      asker_id: 'usr_asker00000000000001',
      privacy_policy: '',
      auto_send: 0,
      created_at_ms: 0,
      updated_at_ms: 0,
      revoked_at_ms: null,
    })
    const tool = askCollaboratorToolForTest()
    await tool.execute('t1', {
      peer_handle: '@cirne',
      question: 'Summary for Marcus meeting?',
    })
    expect(mockGetBrainQueryGrantById).not.toHaveBeenCalled()
    expect(mockResolveConfirmedHandle).toHaveBeenCalledWith({
      handle: 'cirne',
      excludeUserId: 'usr_asker00000000000001',
    })
    expect(mockGetActiveBrainQueryGrant).toHaveBeenCalledWith({
      ownerId: 'usr_owner00000000000002',
      askerId: 'usr_asker00000000000001',
    })
    expect(mockCreateNotificationForTenant).toHaveBeenCalledWith('usr_owner00000000000002', {
      sourceKind: 'brain_query_question',
      payload: expect.objectContaining({
        grantId: 'bqg_0123456789abcdef01234567',
        question: 'Summary for Marcus meeting?',
      }),
    })
  })

  it('resolves grant via peer_user_id when grant_id omitted', async () => {
    mockGetBrainQueryGrantById.mockReturnValue(null)
    const peerOwner = 'usr_12345678901234567890'
    mockGetActiveBrainQueryGrant.mockReturnValue({
      id: 'bqg_abcdabcdabcdabcdabcdabcd',
      owner_id: peerOwner,
      asker_id: 'usr_asker00000000000001',
      privacy_policy: '',
      auto_send: 0,
      created_at_ms: 0,
      updated_at_ms: 0,
      revoked_at_ms: null,
    })
    const tool = askCollaboratorToolForTest()
    await tool.execute('t1', {
      peer_user_id: peerOwner,
      question: 'Ping',
    })
    expect(mockResolveConfirmedHandle).not.toHaveBeenCalled()
    expect(mockCreateNotificationForTenant).toHaveBeenCalledWith(peerOwner, expect.any(Object))
  })

  it('rejects when peer_handle valid but no active grant', async () => {
    mockGetBrainQueryGrantById.mockReturnValue(null)
    mockResolveConfirmedHandle.mockResolvedValue({
      userId: 'usr_owner00000000000002',
      handle: 'cirne',
      primaryEmail: 'c@test.dev',
    })
    mockGetActiveBrainQueryGrant.mockReturnValue(null)
    const tool = askCollaboratorToolForTest()
    await expect(
      tool.execute('t1', { peer_handle: 'cirne', question: 'Hi' }),
    ).rejects.toThrow('has not granted')
  })

  it('rejects when no grant_id peer_handle or peer_user_id', async () => {
    const tool = askCollaboratorToolForTest()
    await expect(tool.execute('t1', { question: 'Hi' })).rejects.toThrow(
      'Provide grant_id, peer_handle',
    )
  })

  it('prefers grant_id when peer_handle also passed', async () => {
    mockResolveConfirmedHandle.mockResolvedValue({
      userId: 'usr_owner00000000000002',
      handle: 'cirne',
      primaryEmail: 'c@test.dev',
    })
    const tool = askCollaboratorToolForTest()
    await tool.execute('t1', {
      grant_id: 'bqg_0123456789abcdef01234567',
      peer_handle: 'wrong-handle',
      question: 'Q',
    })
    expect(mockResolveConfirmedHandle).not.toHaveBeenCalled()
    expect(mockGetActiveBrainQueryGrant).not.toHaveBeenCalled()
    expect(mockCreateNotificationForTenant).toHaveBeenCalledWith('usr_owner00000000000002', expect.any(Object))
  })
})
