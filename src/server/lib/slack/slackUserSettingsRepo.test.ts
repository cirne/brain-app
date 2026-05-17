import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { createBrainQueryCustomPolicy } from '@server/lib/brainQuery/brainQueryCustomPoliciesRepo.js'
import {
  DEFAULT_SLACK_USER_SETTINGS,
  getSlackUserSettings,
  isSlackInboundPolicyIdForTenant,
  normalizeSlackInboundPolicyId,
  upsertSlackUserSettings,
} from './slackUserSettingsRepo.js'

describe('slackUserSettingsRepo', () => {
  let dbPath: string
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slack-user-settings-'))
    dbPath = join(dir, 'brain-global.sqlite')
    process.env.BRAIN_GLOBAL_SQLITE_PATH = dbPath
    closeBrainGlobalDbForTests()
  })

  afterEach(async () => {
    closeBrainGlobalDbForTests()
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    await rm(join(dbPath, '..'), { recursive: true, force: true })
  })

  it('returns defaults when no row', () => {
    expect(getSlackUserSettings({ tenantUserId: 'usr_a', slackTeamId: 'T001' })).toEqual(DEFAULT_SLACK_USER_SETTINGS)
  })

  it('normalizes legacy inbound policy values', () => {
    expect(normalizeSlackInboundPolicyId('always-review')).toBe('general')
    expect(normalizeSlackInboundPolicyId('auto-send')).toBe('general')
    expect(normalizeSlackInboundPolicyId('trusted')).toBe('trusted')
  })

  it('round-trips persist', () => {
    upsertSlackUserSettings({
      tenantUserId: 'usr_a',
      slackTeamId: 'T001',
      autorespond: true,
      inboundPolicy: 'minimal-disclosure',
    })
    expect(getSlackUserSettings({ tenantUserId: 'usr_a', slackTeamId: 'T001' })).toEqual({
      autorespond: true,
      inboundPolicy: 'minimal-disclosure',
    })
  })

  it('second upsert overwrites values', () => {
    upsertSlackUserSettings({
      tenantUserId: 'usr_a',
      slackTeamId: 'T001',
      autorespond: true,
      inboundPolicy: 'trusted',
    })
    upsertSlackUserSettings({
      tenantUserId: 'usr_a',
      slackTeamId: 'T001',
      autorespond: false,
      inboundPolicy: 'general',
    })
    expect(getSlackUserSettings({ tenantUserId: 'usr_a', slackTeamId: 'T001' })).toEqual({
      autorespond: false,
      inboundPolicy: 'general',
    })
  })

  it('isolates tenants and workspaces', () => {
    upsertSlackUserSettings({
      tenantUserId: 'usr_a',
      slackTeamId: 'T001',
      autorespond: true,
      inboundPolicy: 'trusted',
    })
    upsertSlackUserSettings({
      tenantUserId: 'usr_b',
      slackTeamId: 'T001',
      autorespond: false,
      inboundPolicy: 'general',
    })
    upsertSlackUserSettings({
      tenantUserId: 'usr_a',
      slackTeamId: 'T002',
      autorespond: false,
      inboundPolicy: 'general',
    })
    expect(getSlackUserSettings({ tenantUserId: 'usr_a', slackTeamId: 'T001' }).autorespond).toBe(true)
    expect(getSlackUserSettings({ tenantUserId: 'usr_b', slackTeamId: 'T001' }).inboundPolicy).toBe('general')
    expect(getSlackUserSettings({ tenantUserId: 'usr_a', slackTeamId: 'T002' }).autorespond).toBe(false)
  })

  it('accepts owned custom policy ids', () => {
    const pol = createBrainQueryCustomPolicy({
      ownerId: 'usr_a',
      title: 'Exec',
      body: 'Share little.',
    })
    expect(isSlackInboundPolicyIdForTenant(pol.id, 'usr_a')).toBe(true)
    expect(isSlackInboundPolicyIdForTenant(pol.id, 'usr_b')).toBe(false)
    upsertSlackUserSettings({
      tenantUserId: 'usr_a',
      slackTeamId: 'T001',
      autorespond: false,
      inboundPolicy: pol.id as `bqc_${string}`,
    })
    expect(getSlackUserSettings({ tenantUserId: 'usr_a', slackTeamId: 'T001' }).inboundPolicy).toBe(pol.id)
  })
})
