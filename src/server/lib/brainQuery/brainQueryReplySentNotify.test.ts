import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockResolveUserByEmail,
  mockGetActiveGrant,
  mockCreateNotificationForTenant,
  mockReadHandleMeta,
} = vi.hoisted(() => ({
  mockResolveUserByEmail: vi.fn(),
  mockGetActiveGrant: vi.fn(),
  mockCreateNotificationForTenant: vi.fn().mockResolvedValue({ id: 'nid-1' }),
  mockReadHandleMeta: vi.fn().mockResolvedValue({
    handle: 'alice',
    confirmedAt: '2026-01-01',
  }),
}))

vi.mock('@server/lib/tenant/workspaceHandleDirectory.js', () => ({
  resolveUserIdByPrimaryEmail: mockResolveUserByEmail,
}))

vi.mock('@server/lib/brainQuery/brainQueryGrantsRepo.js', () => ({
  getActiveBrainQueryGrant: mockGetActiveGrant,
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
  tenantHomeDir: (id: string) => `/tmp/bt/${id}`,
}))

import { notifyAskerBrainQueryReplySent } from './brainQueryReplySentNotify.js'

describe('notifyAskerBrainQueryReplySent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadHandleMeta.mockResolvedValue({
      handle: 'alice',
      confirmedAt: '2026-01-01',
    })
  })

  it('does nothing when subject is not Braintunnel collaborator mail', async () => {
    const ok = await notifyAskerBrainQueryReplySent('usr_owner11111111111111', {
      id: 'd1',
      subject: 'Hey there',
      body: 'Hi',
      to: ['asker@test.dev'],
      createdAt: '',
      updatedAt: '',
    })
    expect(ok).toBe(false)
    expect(mockCreateNotificationForTenant).not.toHaveBeenCalled()
  })

  it('notifies matching asker and uses idempotent draft-based key', async () => {
    mockResolveUserByEmail.mockResolvedValue('usr_asker00000000000001')
    mockGetActiveGrant.mockReturnValue({
      id: 'bqg_0123456789abcdef01234567',
      owner_id: 'usr_owner11111111111111',
      asker_id: 'usr_asker00000000000001',
      privacy_policy: '',
      created_at_ms: 0,
      updated_at_ms: 0,
      revoked_at_ms: null,
    })
    const ok = await notifyAskerBrainQueryReplySent('usr_owner11111111111111', {
      id: 'draft-uuid-one',
      subject: 'Re: [braintunnel] Status update',
      body: 'Here you go.',
      to: ['Asker Display <ASKER@test.dev>'],
      createdAt: '',
      updatedAt: '',
    })
    expect(ok).toBe(true)
    expect(mockCreateNotificationForTenant).toHaveBeenCalledWith('usr_asker00000000000001', {
      sourceKind: 'brain_query_reply_sent',
      idempotencyKey: 'brain_query_reply_sent:draft-uuid-one',
      payload: {
        grantId: 'bqg_0123456789abcdef01234567',
        peerUserId: 'usr_owner11111111111111',
        subject: 'Re: [braintunnel] Status update',
        peerHandle: 'alice',
      },
    })
  })

  it('skips notify when recipient is not registered asker for owner', async () => {
    mockResolveUserByEmail.mockResolvedValue('usr_unknown99999999999999')
    mockGetActiveGrant.mockReturnValue(null)
    const ok = await notifyAskerBrainQueryReplySent('usr_owner11111111111111', {
      id: 'd2',
      subject: '[braintunnel] Hi',
      body: '',
      to: ['rando@example.com'],
      createdAt: '',
      updatedAt: '',
    })
    expect(ok).toBe(false)
    expect(mockCreateNotificationForTenant).not.toHaveBeenCalled()
  })
})
