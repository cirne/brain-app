import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
import { createNotification, listNotifications } from '@server/lib/notifications/notificationsRepo.js'
import { toolResultFirstText } from './agentTestUtils.js'

describe('mark_notification tool', () => {
  beforeEach(() => {
    closeTenantDbForTests()
  })

  afterEach(async () => {
    closeTenantDbForTests()
    delete process.env.BRAIN_HOME
  })

  it('patches notification state', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mark-notif-tool-'))
    process.env.BRAIN_HOME = home

    const wikiDir = join(home, 'wiki')
    await mkdir(wikiDir, { recursive: true })

    const row = createNotification({
      sourceKind: 'mail_notify',
      payload: { messageId: 'x', subject: 'Hi' },
    })

    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
    const tool = tools.find((t) => t.name === 'mark_notification')!
    const result = await tool.execute('tc1', { notification_id: row.id, state: 'read' })
    expect(toolResultFirstText(result)).toContain('marked read')

    const unread = listNotifications({ state: 'unread' })
    expect(unread).toHaveLength(0)

    await rm(home, { recursive: true, force: true })
  })

  it('returns not found for unknown id', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mark-notif-miss-'))
    process.env.BRAIN_HOME = home
    const wikiDir = join(home, 'wiki')
    await mkdir(wikiDir, { recursive: true })

    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir, { includeLocalMessageTools: false })
    const tool = tools.find((t) => t.name === 'mark_notification')!
    const result = await tool.execute('tc2', { notification_id: 'no-such-id', state: 'dismissed' })
    expect(toolResultFirstText(result)).toContain('No notification found')

    await rm(home, { recursive: true, force: true })
  })
})
