import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests, getBrainGlobalDb } from '@server/lib/global/brainGlobalDb.js'
import {
  acceptShare,
  createShare,
  deleteWikiSharesForOwner,
  getShareByToken,
  granteeCanReadOwnerWikiPath,
  listSharesForGrantee,
  listSharesForOwner,
  normalizeWikiSharePathPrefix,
  revokeShare,
  WIKI_SHARE_INVITE_TTL_MS,
} from './wikiSharesRepo.js'

describe('wikiSharesRepo', () => {
  let dbPath: string
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wsh-repo-'))
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

  it('normalizeWikiSharePathPrefix adds trailing slash and strips leading slash', () => {
    expect(normalizeWikiSharePathPrefix('trips')).toBe('trips/')
    expect(normalizeWikiSharePathPrefix('/ideas/')).toBe('ideas/')
  })

  it('createShare, list for owner and grantee after accept', () => {
    const ownerId = 'usr_11111111111111111111'
    const granteeId = 'usr_22222222222222222222'
    const row = createShare({
      ownerId,
      granteeEmail: 'Alice@Example.com',
      pathPrefix: 'trips',
    })
    expect(row.grantee_email).toBe('alice@example.com')
    expect(row.path_prefix).toBe('trips/')
    expect(row.invite_token.length).toBeGreaterThan(10)

    const owned = listSharesForOwner(ownerId)
    expect(owned).toHaveLength(1)

    const accepted = acceptShare({
      token: row.invite_token,
      granteeId,
      granteeEmail: 'alice@example.com',
    })
    expect(accepted?.grantee_id).toBe(granteeId)
    expect(accepted?.accepted_at_ms).toBeTypeOf('number')

    const received = listSharesForGrantee(granteeId)
    expect(received).toHaveLength(1)

    expect(
      granteeCanReadOwnerWikiPath({
        granteeId,
        ownerId,
        wikiRelPath: 'trips/foo.md',
      }),
    ).toBe(true)
    expect(
      granteeCanReadOwnerWikiPath({
        granteeId,
        ownerId,
        wikiRelPath: 'other/foo.md',
      }),
    ).toBe(false)
  })

  it('revokeShare removes grantee access', () => {
    const ownerId = 'usr_33333333333333333333'
    const granteeId = 'usr_44444444444444444444'
    const row = createShare({
      ownerId,
      granteeEmail: 'b@b.com',
      pathPrefix: 'a/',
    })
    acceptShare({
      token: row.invite_token,
      granteeId,
      granteeEmail: 'b@b.com',
    })
    expect(revokeShare({ shareId: row.id, ownerId })).toBe(true)
    expect(
      granteeCanReadOwnerWikiPath({
        granteeId,
        ownerId,
        wikiRelPath: 'a/x.md',
      }),
    ).toBe(false)
    expect(listSharesForOwner(ownerId)).toHaveLength(0)
  })

  it('deleteWikiSharesForOwner removes all rows for owner only', () => {
    const o1 = 'usr_aaaaaaaaaaaaaaaaaaaaaa'
    const o2 = 'usr_bbbbbbbbbbbbbbbbbbbbbb'
    createShare({ ownerId: o1, granteeEmail: 'a@a.com', pathPrefix: 'x' })
    createShare({ ownerId: o1, granteeEmail: 'b@b.com', pathPrefix: 'y' })
    createShare({ ownerId: o2, granteeEmail: 'c@c.com', pathPrefix: 'z' })
    expect(deleteWikiSharesForOwner(o1)).toBe(2)
    expect(listSharesForOwner(o1)).toHaveLength(0)
    expect(listSharesForOwner(o2)).toHaveLength(1)
    expect(deleteWikiSharesForOwner(o1)).toBe(0)
  })

  it('acceptShare fails after TTL', () => {
    const row = createShare({
      ownerId: 'usr_55555555555555555555',
      granteeEmail: 'c@c.com',
      pathPrefix: 'x',
    })
    const db = getBrainGlobalDb()
    const old = Date.now() - WIKI_SHARE_INVITE_TTL_MS - 60_000
    db.prepare(`UPDATE wiki_shares SET created_at_ms = ? WHERE id = ?`).run(old, row.id)

    const out = acceptShare({
      token: row.invite_token,
      granteeId: 'usr_66666666666666666666',
      granteeEmail: 'c@c.com',
    })
    expect(out).toBeNull()
  })

  it('getShareByToken returns row', () => {
    const row = createShare({
      ownerId: 'usr_77777777777777777777',
      granteeEmail: 'd@d.com',
      pathPrefix: 'p',
    })
    expect(getShareByToken(row.invite_token)?.id).toBe(row.id)
    expect(getShareByToken('nope')).toBeNull()
  })
})
