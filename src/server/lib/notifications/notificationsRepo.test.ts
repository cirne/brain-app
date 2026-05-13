import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
import {
  createNotification,
  listNotifications,
  patchNotificationState,
  deleteAllNotifications,
} from './notificationsRepo.js'

const mockNotifyTunnel = vi.fn()
vi.mock('@server/lib/hub/hubSseBroker.js', () => ({
  notifyNotificationsChanged: vi.fn(),
  notifyBrainTunnelActivity: (...args: unknown[]) => mockNotifyTunnel(...args),
}))

describe('notificationsRepo', () => {
  beforeEach(() => {
    closeTenantDbForTests()
    mockNotifyTunnel.mockClear()
  })

  afterEach(async () => {
    closeTenantDbForTests()
    delete process.env.BRAIN_HOME
  })

  it('creates, lists, filters by state, patches', async () => {
    const home = await mkdtemp(join(tmpdir(), 'notif-repo-'))
    process.env.BRAIN_HOME = home

    const first = createNotification({
      sourceKind: 'system',
      payload: { msg: 'hello' },
    })
    expect(first.state).toBe('unread')
    createNotification({
      sourceKind: 'system',
      payload: { msg: 'two' },
    })

    const all = listNotifications({})
    expect(all).toHaveLength(2)

    const unread = listNotifications({ state: 'unread' })
    expect(unread).toHaveLength(2)

    const patched = patchNotificationState(first.id, 'read')
    expect(patched?.state).toBe('read')

    expect(listNotifications({ state: 'unread' })).toHaveLength(1)
    expect(listNotifications({ state: 'read', limit: 10 })).toHaveLength(1)

    await rm(home, { recursive: true, force: true })
  })

  it('dedupes by idempotency key', async () => {
    const home = await mkdtemp(join(tmpdir(), 'notif-idem-'))
    process.env.BRAIN_HOME = home

    const k = 'idem-1'
    const first = createNotification({
      sourceKind: 'brief',
      payload: { n: 1 },
      idempotencyKey: k,
    })
    const second = createNotification({
      sourceKind: 'brief',
      payload: { n: 2 },
      idempotencyKey: k,
    })
    expect(second.id).toBe(first.id)
    expect(second.payload).toEqual({ n: 1 })
    expect(listNotifications({})).toHaveLength(1)

    await rm(home, { recursive: true, force: true })
  })

  it('deleteAllNotifications clears rows', async () => {
    const home = await mkdtemp(join(tmpdir(), 'notif-clear-'))
    process.env.BRAIN_HOME = home
    createNotification({ sourceKind: 'x', payload: null })
    expect(listNotifications({})).toHaveLength(1)
    deleteAllNotifications()
    expect(listNotifications({})).toHaveLength(0)
    await rm(home, { recursive: true, force: true })
  })

  it('calls notifyBrainTunnelActivity for tunnel-related notification kinds', async () => {
    const home = await mkdtemp(join(tmpdir(), 'notif-tunnel-'))
    process.env.BRAIN_HOME = home

    createNotification({
      sourceKind: 'b2b_tunnel_outbound_updated',
      payload: {
        grantId: 'g1',
        outboundSessionId: 'out-s1',
      },
    })
    expect(mockNotifyTunnel).toHaveBeenCalledTimes(1)
    expect(JSON.parse(mockNotifyTunnel.mock.calls[0]![0] as string)).toEqual({
      scope: 'outbound',
      outboundSessionId: 'out-s1',
      grantId: 'g1',
    })

    createNotification({
      sourceKind: 'system',
      payload: {},
    })
    expect(mockNotifyTunnel).toHaveBeenCalledTimes(1)

    await rm(home, { recursive: true, force: true })
  })
})
