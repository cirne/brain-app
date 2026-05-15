import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { createBrainQueryCustomPolicy } from '@server/lib/brainQuery/brainQueryCustomPoliciesRepo.js'
import {
  assertGrantPrivacyXor,
  createBrainQueryGrant,
  deleteBrainQueryGrantsForOwner,
  deleteBrainQueryGrantsForTenant,
  getBrainQueryGrantById,
  getActiveBrainQueryGrant,
  listBrainQueryGrantsForAsker,
  listBrainQueryGrantsForOwner,
  revokeBrainQueryGrant,
  revokeBrainQueryGrantAndReciprocal,
  revokeBrainQueryGrantAsAsker,
  updateBrainQueryGrantPrivacyInstructions,
  setBrainQueryGrantPolicy,
} from './brainQueryGrantsRepo.js'

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

  it('createBrainQueryGrant stores preset key XOR custom policy id', () => {
    const row = createBrainQueryGrant({
      ownerId: 'usr_11111111111111111111',
      askerId: 'usr_22222222222222222222',
      presetPolicyKey: 'general',
    })
    expect(row.preset_policy_key).toBe('general')
    expect(row.custom_policy_id).toBeNull()
    expect(row.reply_mode).toBe('review')
    expect(row.revoked_at_ms).toBeNull()
    assertGrantPrivacyXor(row)
  })

  it('setBrainQueryGrantPolicy toggles and rejects wrong owner', () => {
    const owner = 'usr_autosend_own_oooooooooo'
    const asker = 'usr_autosend_ask_aaaaaaaaaa'
    const row = createBrainQueryGrant({ ownerId: owner, askerId: asker, presetPolicyKey: 'general' })
    expect(row.reply_mode).toBe('review')
    const on = setBrainQueryGrantPolicy({ grantId: row.id, ownerId: owner, policy: 'auto' })
    expect(on?.reply_mode).toBe('auto')
    const off = setBrainQueryGrantPolicy({ grantId: row.id, ownerId: owner, policy: 'review' })
    expect(off?.reply_mode).toBe('review')
    expect(setBrainQueryGrantPolicy({ grantId: row.id, ownerId: 'usr_wrong', policy: 'auto' })).toBeNull()
  })

  it('getActiveBrainQueryGrant returns row; null after revoke', () => {
    const owner = 'usr_aaaaaaaaaaaaaaaaaaaaaa'
    const asker = 'usr_bbbbbbbbbbbbbbbbbbbbbb'
    const row = createBrainQueryGrant({ ownerId: owner, askerId: asker, presetPolicyKey: 'general' })
    expect(getActiveBrainQueryGrant({ ownerId: owner, askerId: asker })?.id).toBe(row.id)
    expect(revokeBrainQueryGrant({ grantId: row.id, ownerId: owner })).toBe(true)
    expect(getActiveBrainQueryGrant({ ownerId: owner, askerId: asker })).toBeNull()
  })

  it('revokeBrainQueryGrantAndReciprocal revokes reciprocal row when present', () => {
    const a = 'usr_rqqqqqqqqqqqqqqqqqqq'
    const b = 'usr_rrrrrrrrrrrrrrrrrrrr'
    const polA = createBrainQueryCustomPolicy({ ownerId: a, title: 'a', body: 'one' })
    const polB = createBrainQueryCustomPolicy({ ownerId: b, title: 'b', body: 'two' })
    const ab = createBrainQueryGrant({ ownerId: a, askerId: b, customPolicyId: polA.id })
    const ba = createBrainQueryGrant({ ownerId: b, askerId: a, customPolicyId: polB.id })
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
    const pol = createBrainQueryCustomPolicy({ ownerId: owner, title: 't', body: 'x' })
    const inbound = createBrainQueryGrant({ ownerId: owner, askerId: asker, customPolicyId: pol.id })
    expect(revokeBrainQueryGrantAsAsker({ grantId: inbound.id, askerId: asker })).toBe(true)
    expect(getActiveBrainQueryGrant({ ownerId: owner, askerId: asker })).toBeNull()
  })

  it('updateBrainQueryGrantPrivacyInstructions switches to custom body', () => {
    const owner = 'usr_uuuuuuuuuuuuuuuuuuuuu'
    const asker = 'usr_vvvvvvvvvvvvvvvvvvvv'
    const pol = createBrainQueryCustomPolicy({ ownerId: owner, title: 't', body: 'Only high-level summaries.' })
    const row = createBrainQueryGrant({ ownerId: owner, askerId: asker, presetPolicyKey: 'general' })
    const updated = updateBrainQueryGrantPrivacyInstructions({
      grantId: row.id,
      ownerId: owner,
      customPolicyId: pol.id,
    })
    expect(updated?.custom_policy_id).toBe(pol.id)
    expect(updated?.preset_policy_key).toBeNull()
  })

  it('listBrainQueryGrantsForOwner and ForAsker', () => {
    const o = 'usr_ownnnnnnnnnnnnnnnnnnn'
    const a1 = 'usr_ask11111111111111111'
    const a2 = 'usr_ask22222222222222222'
    createBrainQueryGrant({ ownerId: o, askerId: a1, presetPolicyKey: 'general' })
    createBrainQueryGrant({ ownerId: o, askerId: a2, presetPolicyKey: 'general' })
    expect(listBrainQueryGrantsForOwner(o)).toHaveLength(2)
    expect(listBrainQueryGrantsForAsker(a1)).toHaveLength(1)
  })

  it('deleteBrainQueryGrantsForTenant removes rows as owner or asker', () => {
    const alice = 'usr_aaaaaaaaaaaaaaaaaaaaaa'
    const bob = 'usr_bbbbbbbbbbbbbbbbbbbbbb'
    const carol = 'usr_cccccccccccccccccccccc'
    createBrainQueryGrant({ ownerId: alice, askerId: bob, presetPolicyKey: 'general' })
    createBrainQueryGrant({ ownerId: carol, askerId: alice, presetPolicyKey: 'general' })
    expect(deleteBrainQueryGrantsForTenant(alice)).toBe(2)
    expect(listBrainQueryGrantsForOwner(alice)).toHaveLength(0)
    expect(listBrainQueryGrantsForAsker(alice)).toHaveLength(0)
    expect(listBrainQueryGrantsForOwner(carol)).toHaveLength(0)
  })

  it('deleteBrainQueryGrantsForOwner removes only rows where user is owner', () => {
    const o1 = 'usr_d1dddddddddddddddddddd'
    const o2 = 'usr_d2dddddddddddddddddddd'
    createBrainQueryGrant({ ownerId: o1, askerId: 'usr_g1111111111111111111', presetPolicyKey: 'general' })
    createBrainQueryGrant({ ownerId: o1, askerId: 'usr_g2222222222222222222', presetPolicyKey: 'general' })
    createBrainQueryGrant({ ownerId: o2, askerId: 'usr_g3333333333333333333', presetPolicyKey: 'general' })
    expect(deleteBrainQueryGrantsForOwner(o1)).toBe(2)
    expect(listBrainQueryGrantsForOwner(o1)).toHaveLength(0)
    expect(listBrainQueryGrantsForOwner(o2)).toHaveLength(1)
  })

  it('createBrainQueryGrant replaces prior row for same owner/asker pair', () => {
    const o = 'usr_uniq1111111111111111'
    const a = 'usr_uniq2222222222222222'
    const p1 = createBrainQueryCustomPolicy({ ownerId: o, title: '1', body: 'first' })
    const p2 = createBrainQueryCustomPolicy({ ownerId: o, title: '2', body: 'second' })
    const r1 = createBrainQueryGrant({ ownerId: o, askerId: a, customPolicyId: p1.id })
    const r2 = createBrainQueryGrant({ ownerId: o, askerId: a, customPolicyId: p2.id })
    expect(r2.id).not.toBe(r1.id)
    expect(r2.custom_policy_id).toBe(p2.id)
    expect(getBrainQueryGrantById(r1.id)).toBeNull()
    expect(getActiveBrainQueryGrant({ ownerId: o, askerId: a })?.id).toBe(r2.id)
  })

  it('createBrainQueryGrant rejects XOR violation', () => {
    expect(() =>
      createBrainQueryGrant({
        ownerId: 'usr_x1xxxxxxxxxxxxxxxxxxxx',
        askerId: 'usr_x2xxxxxxxxxxxxxxxxxxxx',
        presetPolicyKey: 'general',
        customPolicyId: 'bqc_nope',
      }),
    ).toThrow('grant_privacy_xor_invalid')
  })

  it('createBrainQueryGrant rejects missing privacy target', () => {
    expect(() =>
      createBrainQueryGrant({
        ownerId: 'usr_y1yyyyyyyyyyyyyyyyyyyy',
        askerId: 'usr_y2yyyyyyyyyyyyyyyyyyyy',
      }),
    ).toThrow('grant_privacy_xor_invalid')
  })
})
