import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { upsertSlackUserLink, upsertSlackWorkspace } from '@server/lib/slack/slackConnectionsRepo.js'
import { dispatchHelloResponse, isWhoHasBraintunnelQuery } from './helloDispatcher.js'
import type { MessagingQuery } from './types.js'
import { parseFirstSlackUserMention } from './parseSlackMention.js'

describe('helloDispatcher', () => {
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH
  let dbPath: string

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hello-dispatch-'))
    dbPath = join(dir, 'brain-global.sqlite')
    process.env.BRAIN_GLOBAL_SQLITE_PATH = dbPath
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
    await rm(join(dbPath, '..'), { recursive: true, force: true })
  })

  const dmQuery = (text: string, extra?: Partial<MessagingQuery>): MessagingQuery => ({
    slackTeamId: 'T1',
    requesterSlackUserId: 'U_REQ',
    venue: 'dm',
    text,
    rawEventRef: {},
    channelId: 'D1',
    ...extra,
  })

  it('isWhoHasBraintunnelQuery matches phrase list', () => {
    expect(isWhoHasBraintunnelQuery('Who has Braintunnel?')).toBe(true)
    expect(isWhoHasBraintunnelQuery('who else has access to braintunnel?')).toBe(true)
    expect(isWhoHasBraintunnelQuery('hello')).toBe(false)
    expect(isWhoHasBraintunnelQuery('what is braintunnel')).toBe(false)
  })

  it('parseFirstSlackUserMention extracts user id', () => {
    expect(parseFirstSlackUserMention('hey <@U123ABC> what')).toBe('U123ABC')
    expect(parseFirstSlackUserMention('no mention')).toBeNull()
  })

  it('lists linked users for who-has query', async () => {
    upsertSlackUserLink({
      slackTeamId: 'T1',
      slackUserId: 'U1',
      tenantUserId: 'usr_a',
    })
    const r = await dispatchHelloResponse(dmQuery('who has braintunnel'))
    expect(r.text).toContain('People linked to Braintunnel')
    expect(r.text).toContain('U1')
  })

  it('returns not linked message for unlinked mention target', async () => {
    const r = await dispatchHelloResponse(dmQuery('ask <@U0OTHER99> about stuff'))
    expect(r.text).toContain('has not linked')
  })

  it('channel mention returns hello text', async () => {
    const r = await dispatchHelloResponse({
      ...dmQuery(''),
      venue: 'public_channel',
    })
    expect(r.text).toContain('hello-world')
  })
})
