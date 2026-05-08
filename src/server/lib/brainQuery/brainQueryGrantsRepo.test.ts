import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { DEFAULT_BRAIN_QUERY_PRIVACY_POLICY } from './defaultPrivacyPolicy.js'
import {
  createBrainQueryGrant,
  deleteBrainQueryGrantsForOwner,
  deleteBrainQueryGrantsForTenant,
  getActiveBrainQueryGrant,
  listBrainQueryGrantsForAsker,
  listBrainQueryGrantsForOwner,
  revokeBrainQueryGrant,
  revokeBrainQueryGrantAndReciprocal,
  revokeBrainQueryGrantAsAsker,
  updateBrainQueryGrantPrivacyPolicy,
} from './brainQueryGrantsRepo.js'
import {
  insertBrainQueryLog,
  listBrainQueryLogForAsker,
  listBrainQueryLogForOwner,
} from './brainQueryLogRepo.js'

describe('brainQueryGrantsRepo', () => {
  let dbPath: string
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bqg-repo-'))
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

  it('createBrainQueryGrant seeds default privacy policy', () => {
    const row = createBrainQueryGrant({
      ownerId: 'usr_11111111111111111111',
      askerId: 'usr_22222222222222222222',
    })
    expect(row.privacy_policy).toBe(DEFAULT_BRAIN_QUERY_PRIVACY_POLICY)
    expect(row.revoked_at_ms).toBeNull()
  })

  it('getActiveBrainQueryGrant returns row; null after revoke', () => {
    const owner = 'usr_aaaaaaaaaaaaaaaaaaaaaa'
    const asker = 'usr_bbbbbbbbbbbbbbbbbbbbbb'
    const row = createBrainQueryGrant({ ownerId: owner, askerId: asker })
    expect(getActiveBrainQueryGrant({ ownerId: owner, askerId: asker })?.id).toBe(row.id)
    expect(revokeBrainQueryGrant({ grantId: row.id, ownerId: owner })).toBe(true)
    expect(getActiveBrainQueryGrant({ ownerId: owner, askerId: asker })).toBeNull()
  })

  it('revokeBrainQueryGrantAndReciprocal revokes reciprocal row when present', () => {
    const a = 'usr_rqqqqqqqqqqqqqqqqqqq'
    const b = 'usr_rrrrrrrrrrrrrrrrrrrr'
    const ab = createBrainQueryGrant({ ownerId: a, askerId: b, privacyPolicy: 'one' })
    const ba = createBrainQueryGrant({ ownerId: b, askerId: a, privacyPolicy: 'two' })
    const out = revokeBrainQueryGrantAndReciprocal({ grantId: ab.id, ownerId: a })
    expect(out.revoked).toBe(true)
    expect(out.reciprocalRevoked).toBe(true)
    expect(getActiveBrainQueryGrant({ ownerId: a, askerId: b })).toBeNull()
    expect(getActiveBrainQueryGrant({ ownerId: b, askerId: a })).toBeNull()
    expect(revokeBrainQueryGrantAndReciprocal({ grantId: ba.id, ownerId: b }).revoked).toBe(false)
  })

  it('revokeBrainQueryGrantAsAsker revokes inbound only', () => {
    const owner = 'usr_inown_oooooooooooooooooo'
    const asker = 'usr_inask_aaaaaaaaaaaaaaaaaa'
    const inbound = createBrainQueryGrant({ ownerId: owner, askerId: asker, privacyPolicy: 'x' })
    expect(revokeBrainQueryGrantAsAsker({ grantId: inbound.id, askerId: asker })).toBe(true)
    expect(getActiveBrainQueryGrant({ ownerId: owner, askerId: asker })).toBeNull()
  })

  it('updateBrainQueryGrantPrivacyPolicy', () => {
    const owner = 'usr_uuuuuuuuuuuuuuuuuuuuu'
    const asker = 'usr_vvvvvvvvvvvvvvvvvvvv'
    const row = createBrainQueryGrant({ ownerId: owner, askerId: asker })
    const updated = updateBrainQueryGrantPrivacyPolicy({
      grantId: row.id,
      ownerId: owner,
      privacyPolicy: 'Only high-level summaries.',
    })
    expect(updated?.privacy_policy).toBe('Only high-level summaries.')
  })

  it('listBrainQueryGrantsForOwner and ForAsker', () => {
    const o = 'usr_ownnnnnnnnnnnnnnnnnnn'
    const a1 = 'usr_ask11111111111111111'
    const a2 = 'usr_ask22222222222222222'
    createBrainQueryGrant({ ownerId: o, askerId: a1 })
    createBrainQueryGrant({ ownerId: o, askerId: a2 })
    expect(listBrainQueryGrantsForOwner(o)).toHaveLength(2)
    expect(listBrainQueryGrantsForAsker(a1)).toHaveLength(1)
  })

  it('deleteBrainQueryGrantsForTenant removes rows as owner or asker', () => {
    const alice = 'usr_aaaaaaaaaaaaaaaaaaaaaa'
    const bob = 'usr_bbbbbbbbbbbbbbbbbbbbbb'
    const carol = 'usr_cccccccccccccccccccccc'
    createBrainQueryGrant({ ownerId: alice, askerId: bob })
    createBrainQueryGrant({ ownerId: carol, askerId: alice })
    expect(deleteBrainQueryGrantsForTenant(alice)).toBe(2)
    expect(listBrainQueryGrantsForOwner(alice)).toHaveLength(0)
    expect(listBrainQueryGrantsForAsker(alice)).toHaveLength(0)
    expect(listBrainQueryGrantsForOwner(carol)).toHaveLength(0)
  })

  it('deleteBrainQueryGrantsForOwner removes only rows where user is owner', () => {
    const o1 = 'usr_d1dddddddddddddddddddd'
    const o2 = 'usr_d2dddddddddddddddddddd'
    createBrainQueryGrant({ ownerId: o1, askerId: 'usr_g1111111111111111111' })
    createBrainQueryGrant({ ownerId: o1, askerId: 'usr_g2222222222222222222' })
    createBrainQueryGrant({ ownerId: o2, askerId: 'usr_g3333333333333333333' })
    expect(deleteBrainQueryGrantsForOwner(o1)).toBe(2)
    expect(listBrainQueryGrantsForOwner(o1)).toHaveLength(0)
    expect(listBrainQueryGrantsForOwner(o2)).toHaveLength(1)
  })

  it('UNIQUE(owner_id, asker_id) on second create', () => {
    const o = 'usr_uniq1111111111111111'
    const a = 'usr_uniq2222222222222222'
    createBrainQueryGrant({ ownerId: o, askerId: a })
    expect(() => createBrainQueryGrant({ ownerId: o, askerId: a })).toThrow()
  })
})

describe('brainQueryLogRepo', () => {
  let dbPath: string
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bql-repo-'))
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

  it('insert and list by owner / asker', () => {
    insertBrainQueryLog({
      ownerId: 'usr_o',
      askerId: 'usr_a',
      question: 'Q?',
      draftAnswer: 'draft',
      finalAnswer: 'final',
      filterNotes: null,
      status: 'ok',
      durationMs: 100,
    })
    const oRows = listBrainQueryLogForOwner('usr_o', 10)
    expect(oRows).toHaveLength(1)
    expect(oRows[0].draft_answer).toBe('draft')
    const aRows = listBrainQueryLogForAsker('usr_a', 10)
    expect(aRows).toHaveLength(1)
    expect(aRows[0].final_answer).toBe('final')
  })
})
