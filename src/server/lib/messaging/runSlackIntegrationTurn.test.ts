import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { upsertSlackUserLink, upsertSlackWorkspace } from '@server/lib/slack/slackConnectionsRepo.js'
import { resolveSlackUserIdentity } from './runSlackIntegrationTurn.js'

describe('resolveSlackUserIdentity', () => {
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH
  const prevDataRoot = process.env.BRAIN_DATA_ROOT
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'slack-identity-'))
    process.env.BRAIN_GLOBAL_SQLITE_PATH = join(tmpDir, 'brain-global.sqlite')
    process.env.BRAIN_DATA_ROOT = tmpDir
    closeBrainGlobalDbForTests()
    upsertSlackWorkspace({
      slackTeamId: 'T1',
      teamName: 'Test',
      installerTenantUserId: 'usr_a',
      botToken: 'xoxb',
    })
  })

  afterEach(async () => {
    closeBrainGlobalDbForTests()
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    if (prevDataRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevDataRoot
    else delete process.env.BRAIN_DATA_ROOT
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns display name only when user is not linked', async () => {
    const result = await resolveSlackUserIdentity({
      slackTeamId: 'T1',
      slackUserId: 'U_UNLINKED',
      displayName: 'alice',
    })
    expect(result).toBe('alice')
  })

  it('includes slack_email from link row', async () => {
    upsertSlackUserLink({
      slackTeamId: 'T1',
      slackUserId: 'U1',
      tenantUserId: 'usr_a',
      slackEmail: 'alice@example.com',
    })
    const result = await resolveSlackUserIdentity({
      slackTeamId: 'T1',
      slackUserId: 'U1',
      displayName: 'alice',
    })
    expect(result).toBe('alice (alice@example.com)')
  })

  it('includes additional emails from linked-mailboxes.json', async () => {
    upsertSlackUserLink({
      slackTeamId: 'T1',
      slackUserId: 'U1',
      tenantUserId: 'usr_a',
      slackEmail: 'alice@work.com',
    })
    // Write a linked-mailboxes.json for the tenant with a second email
    const tenantVar = join(tmpDir, 'usr_a', 'var')
    await mkdir(tenantVar, { recursive: true })
    await writeFile(
      join(tenantVar, 'linked-mailboxes.json'),
      JSON.stringify({ v: 1, mailboxes: [{ email: 'alice@personal.com', googleSub: 'sub1', linkedAt: new Date().toISOString() }] }),
    )
    const result = await resolveSlackUserIdentity({
      slackTeamId: 'T1',
      slackUserId: 'U1',
      displayName: 'alice',
    })
    expect(result).toContain('alice@work.com')
    expect(result).toContain('alice@personal.com')
  })

  it('deduplicates emails when slack_email matches a linked mailbox', async () => {
    upsertSlackUserLink({
      slackTeamId: 'T1',
      slackUserId: 'U1',
      tenantUserId: 'usr_a',
      slackEmail: 'alice@example.com',
    })
    const tenantVar = join(tmpDir, 'usr_a', 'var')
    await mkdir(tenantVar, { recursive: true })
    await writeFile(
      join(tenantVar, 'linked-mailboxes.json'),
      JSON.stringify({ v: 1, mailboxes: [{ email: 'alice@example.com', googleSub: 'sub1', linkedAt: new Date().toISOString() }] }),
    )
    const result = await resolveSlackUserIdentity({
      slackTeamId: 'T1',
      slackUserId: 'U1',
      displayName: 'alice',
    })
    // Should appear only once
    expect(result).toBe('alice (alice@example.com)')
  })
})
