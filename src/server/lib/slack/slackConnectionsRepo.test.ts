import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import {
  getSlackWorkspace,
  getWorkspaceBotToken,
  listLinkedUsersInWorkspace,
  listSlackUserLinksForTenant,
  resolveLinkedTenant,
  upsertSlackUserLink,
  upsertSlackWorkspace,
} from './slackConnectionsRepo.js'

describe('slackConnectionsRepo', () => {
  let dbPath: string
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH
  const prevBot = process.env.SLACK_BOT_TOKEN

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slack-conn-'))
    dbPath = join(dir, 'brain-global.sqlite')
    process.env.BRAIN_GLOBAL_SQLITE_PATH = dbPath
    closeBrainGlobalDbForTests()
  })

  afterEach(async () => {
    closeBrainGlobalDbForTests()
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    if (prevBot === undefined) delete process.env.SLACK_BOT_TOKEN
    else process.env.SLACK_BOT_TOKEN = prevBot
    await rm(join(dbPath, '..'), { recursive: true, force: true })
  })

  it('upsertSlackWorkspace and getSlackWorkspace round-trip', () => {
    upsertSlackWorkspace({
      slackTeamId: 'T001',
      teamName: 'Gamaliel',
      installerTenantUserId: 'usr_installer_1111111111',
      botToken: 'xoxb-test',
    })
    const row = getSlackWorkspace('T001')
    expect(row?.team_name).toBe('Gamaliel')
    expect(row?.installer_tenant_user_id).toBe('usr_installer_1111111111')
    expect(row?.bot_token).toBe('xoxb-test')
  })

  it('resolveLinkedTenant and listLinkedUsersInWorkspace', () => {
    upsertSlackWorkspace({
      slackTeamId: 'T001',
      teamName: 'Gamaliel',
      installerTenantUserId: 'usr_a',
      botToken: 'xoxb-a',
    })
    upsertSlackUserLink({
      slackTeamId: 'T001',
      slackUserId: 'U001',
      tenantUserId: 'usr_a',
      slackEmail: 'a@example.com',
    })
    upsertSlackUserLink({
      slackTeamId: 'T001',
      slackUserId: 'U002',
      tenantUserId: 'usr_b',
      slackEmail: 'b@example.com',
    })
    expect(resolveLinkedTenant('T001', 'U001')?.tenant_user_id).toBe('usr_a')
    expect(resolveLinkedTenant('T001', 'U999')).toBeNull()
    const listed = listLinkedUsersInWorkspace('T001')
    expect(listed).toHaveLength(2)
    expect(listSlackUserLinksForTenant('usr_b')).toHaveLength(1)
  })

  it('getWorkspaceBotToken prefers DB then env', () => {
    delete process.env.SLACK_BOT_TOKEN
    expect(getWorkspaceBotToken('T-missing')).toBeNull()
    process.env.SLACK_BOT_TOKEN = 'xoxb-env'
    expect(getWorkspaceBotToken('T-missing')).toBe('xoxb-env')
    upsertSlackWorkspace({
      slackTeamId: 'T001',
      teamName: 'X',
      installerTenantUserId: 'usr_a',
      botToken: 'xoxb-db',
    })
    expect(getWorkspaceBotToken('T001')).toBe('xoxb-db')
  })
})
