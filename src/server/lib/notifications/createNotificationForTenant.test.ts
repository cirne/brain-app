import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureTenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { writeHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
import { createNotificationForTenant } from './createNotificationForTenant.js'
import { listNotifications } from './notificationsRepo.js'

describe('createNotificationForTenant', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  let root: string

  beforeEach(() => {
    closeTenantDbForTests()
  })

  afterEach(async () => {
    closeTenantDbForTests()
    if (prevRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevRoot
    else delete process.env.BRAIN_DATA_ROOT
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('writes to recipient tenant SQLite only', async () => {
    root = await mkdtemp(join(tmpdir(), 'notif-cross-tenant-'))
    process.env.BRAIN_DATA_ROOT = root

    const ownerId = 'usr_aaaaaaaaaaaaaaaaaaaa'
    const recipientId = 'usr_bbbbbbbbbbbbbbbbbbbb'

    ensureTenantHomeDir(ownerId)
    ensureTenantHomeDir(recipientId)
    await writeHandleMeta(ensureTenantHomeDir(recipientId), {
      userId: recipientId,
      handle: 'recipient',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })

    await createNotificationForTenant(recipientId, {
      sourceKind: 'test_kind',
      idempotencyKey: 'test:one',
      payload: { hello: true },
    })

    const recipientRows = await runWithTenantContextAsync(
      { tenantUserId: recipientId, workspaceHandle: 'recipient', homeDir: ensureTenantHomeDir(recipientId) },
      async () => listNotifications({}),
    )
    expect(recipientRows).toHaveLength(1)
    expect(recipientRows[0].sourceKind).toBe('test_kind')
    expect(recipientRows[0].payload).toEqual({ hello: true })

    const ownerRows = await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: ownerId, homeDir: ensureTenantHomeDir(ownerId) },
      async () => listNotifications({}),
    )
    expect(ownerRows).toHaveLength(0)
  })
})
