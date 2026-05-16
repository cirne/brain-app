import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { upsertSlackUserLink, upsertSlackWorkspace } from '@server/lib/slack/slackConnectionsRepo.js'
import {
  dispatchHelloResponse,
  isWhoHasBraintunnelQuery,
  resolveOwnerFromSlackMentions,
} from './helloDispatcher.js'
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
    expect(r.kind).toBe('text')
    if (r.kind === 'text') {
      expect(r.text).toContain('People linked to Braintunnel')
      expect(r.text).toContain('U1')
    }
  })

  it('returns not linked message for unlinked mention target', async () => {
    const r = await dispatchHelloResponse(dmQuery('ask <@U0OTHER99> about stuff'))
    expect(r.kind).toBe('text')
    if (r.kind === 'text') expect(r.text).toContain('has not linked')
  })

  it('ignores bot @mention and routes to self when requester is the subject', () => {
    upsertSlackUserLink({
      slackTeamId: 'T1',
      slackUserId: 'U_REQ',
      tenantUserId: 'usr_req',
    })
    const r = resolveOwnerFromSlackMentions({
      text: '<@UBOT> is <@U_REQ> available to meet tuesday?',
      slackTeamId: 'T1',
      requesterSlackUserId: 'U_REQ',
      botSlackUserId: 'UBOT',
    })
    expect(r).toBeNull()
  })

  it('channel invoke with only bot mention falls through to self via dispatch', async () => {
    upsertSlackUserLink({
      slackTeamId: 'T1',
      slackUserId: 'U_REQ',
      tenantUserId: 'usr_req',
    })
    const r = await dispatchHelloResponse(
      {
        ...dmQuery('<@UBOT> is <@U_REQ> available to meet tuesday?'),
        venue: 'private_group',
        channelId: 'G1',
      },
      { botSlackUserId: 'UBOT' },
    )
    expect(r.kind).toBe('agentRun')
    if (r.kind === 'agentRun') {
      expect(r.ownerSlackUserId).toBe('U_REQ')
      expect(r.ownerTenantUserId).toBe('usr_req')
    }
  })

  it('channel @mention with linked target returns agentRun (skips leading bot mention)', async () => {
    upsertSlackUserLink({
      slackTeamId: 'T1',
      slackUserId: 'UOWNER1',
      tenantUserId: 'usr_owner',
    })
    const r = await dispatchHelloResponse(
      {
        ...dmQuery('<@UBOT> summarize <@UOWNER1> zoom meetings from last week'),
        venue: 'private_group',
        channelId: 'G_PRIVATE',
      },
      { botSlackUserId: 'UBOT' },
    )
    expect(r.kind).toBe('agentRun')
    if (r.kind === 'agentRun') {
      expect(r.ownerSlackUserId).toBe('UOWNER1')
      expect(r.ownerTenantUserId).toBe('usr_owner')
    }
  })

  it('linked mention target returns agentRun with ownerTenantUserId', async () => {
    upsertSlackUserLink({
      slackTeamId: 'T1',
      slackUserId: 'UOWNER1',
      tenantUserId: 'usr_owner',
    })
    const r = await dispatchHelloResponse(dmQuery('what does <@UOWNER1> think about X?'))
    expect(r.kind).toBe('agentRun')
    if (r.kind === 'agentRun') {
      expect(r.ownerSlackUserId).toBe('UOWNER1')
      expect(r.ownerTenantUserId).toBe('usr_owner')
    }
  })

  it('self-DM with linked requester returns agentRun targeting self', async () => {
    upsertSlackUserLink({
      slackTeamId: 'T1',
      slackUserId: 'U_REQ',  // U_REQ is used as requesterSlackUserId in dmQuery
      tenantUserId: 'usr_req',
    })
    const r = await dispatchHelloResponse(dmQuery('what is my schedule today?'))
    expect(r.kind).toBe('agentRun')
    if (r.kind === 'agentRun') {
      expect(r.ownerTenantUserId).toBe('usr_req')
    }
  })

  it('no "ambassador" in any response text', async () => {
    const r = await dispatchHelloResponse(dmQuery('hello'))
    if (r.kind === 'text') {
      expect(r.text.toLowerCase()).not.toContain('ambassador')
    }
  })
})
