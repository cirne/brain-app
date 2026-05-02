import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests, getBrainGlobalDb } from '@server/lib/global/brainGlobalDb.js'
import {
  acceptShare,
  acceptShareById,
  createShare,
  deleteWikiSharesForOwner,
  getShareByToken,
  granteeCanReadOwnerWikiPath,
  granteeShareCoversWikiPath,
  listPendingInvitesForGranteeEmail,
  listSharesForGrantee,
  listSharesForOwner,
  normalizeWikiSharePathPrefix,
  revokeShare,
  wikiPathUnderSharePrefix,
  WIKI_SHARE_INVITE_TTL_MS,
  type WikiShareRow,
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

  it('listPendingInvitesForGranteeEmail lists non-accepted invites for email within TTL', () => {
    const ownerId = 'usr_pendingown1111111111'
    const row = createShare({
      ownerId,
      granteeEmail: 'Pending@Example.com',
      pathPrefix: 'trips',
    })
    const pending = listPendingInvitesForGranteeEmail('pending@example.com')
    expect(pending.map((r) => r.id)).toEqual([row.id])

    expect(listPendingInvitesForGranteeEmail('other@example.com')).toHaveLength(0)

    acceptShare({ token: row.invite_token, granteeId: 'usr_grantee111111111111', granteeEmail: 'pending@example.com' })
    expect(listPendingInvitesForGranteeEmail('pending@example.com')).toHaveLength(0)

    const row2 = createShare({
      ownerId,
      granteeEmail: 'Pending@Example.com',
      pathPrefix: 'ideas',
    })
    revokeShare({ shareId: row2.id, ownerId })
    expect(listPendingInvitesForGranteeEmail('pending@example.com')).toHaveLength(0)

    const row3 = createShare({
      ownerId,
      granteeEmail: 'ttl@example.com',
      pathPrefix: 'x',
    })
    const db = getBrainGlobalDb()
    const old = Date.now() - WIKI_SHARE_INVITE_TTL_MS - 60_000
    db.prepare(`UPDATE wiki_shares SET created_at_ms = ? WHERE id = ?`).run(old, row3.id)
    expect(listPendingInvitesForGranteeEmail('ttl@example.com')).toHaveLength(0)
  })

  it('acceptShareById matches acceptShare token behavior', () => {
    const ownerId = 'usr_acceptid111111111111'
    const granteeId = 'usr_acceptid222222222222'
    const row = createShare({
      ownerId,
      granteeEmail: 'byid@example.com',
      pathPrefix: 'x',
    })
    const out = acceptShareById({
      shareId: row.id,
      granteeId,
      granteeEmail: 'byid@example.com',
    })
    expect(out?.grantee_id).toBe(granteeId)
    expect(listSharesForGrantee(granteeId)).toHaveLength(1)

    const row2 = createShare({
      ownerId,
      granteeEmail: 'byid@example.com',
      pathPrefix: 'y',
    })
    expect(
      acceptShareById({
        shareId: row2.id,
        granteeId,
        granteeEmail: 'wrong@example.com',
      }),
    ).toBeNull()

    expect(revokeShare({ shareId: row2.id, ownerId })).toBe(true)
    expect(
      acceptShareById({
        shareId: row2.id,
        granteeId: 'usr_other333333333333',
        granteeEmail: 'byid@example.com',
      }),
    ).toBeNull()
  })

  it('acceptShareById is idempotent for same grantee', () => {
    const ownerId = 'usr_idemp11111111111111'
    const granteeId = 'usr_idemp22222222222222'
    const row = createShare({
      ownerId,
      granteeEmail: 'idem@example.com',
      pathPrefix: 'z',
    })
    const first = acceptShareById({ shareId: row.id, granteeId, granteeEmail: 'idem@example.com' })
    const second = acceptShareById({ shareId: row.id, granteeId, granteeEmail: 'idem@example.com' })
    expect(second?.grantee_id).toBe(granteeId)
    expect(second?.accepted_at_ms).toBe(first?.accepted_at_ms)
  })

  describe('wikiPathUnderSharePrefix', () => {
    it('treats directory root and children as in-prefix', () => {
      expect(wikiPathUnderSharePrefix('trips', 'trips/')).toBe(true)
      expect(wikiPathUnderSharePrefix('trips/', 'trips/')).toBe(true)
      expect(wikiPathUnderSharePrefix('trips/virginia/trip.md', 'trips/')).toBe(true)
    })

    it('rejects prefix without trailing slash', () => {
      expect(wikiPathUnderSharePrefix('trips/foo.md', 'trips')).toBe(false)
    })

    it('rejects paths outside prefix', () => {
      expect(wikiPathUnderSharePrefix('other/foo.md', 'trips/')).toBe(false)
    })

    it('normalizes leading slashes on wiki path', () => {
      expect(wikiPathUnderSharePrefix('/trips/a.md', 'trips/')).toBe(true)
    })
  })

  describe('granteeShareCoversWikiPath', () => {
    function rowDir(prefix: string): WikiShareRow {
      return {
        id: '',
        owner_id: 'o',
        grantee_email: '',
        grantee_id: 'g',
        path_prefix: prefix,
        target_kind: 'dir',
        invite_token: '',
        created_at_ms: 0,
        accepted_at_ms: 1,
        revoked_at_ms: null,
      }
    }
    function rowFile(mdPath: string): WikiShareRow {
      return { ...rowDir(mdPath), target_kind: 'file', path_prefix: mdPath }
    }

    it('dir share covers subtree only', () => {
      const r = rowDir('ideas/')
      expect(granteeShareCoversWikiPath(r, 'ideas/note.md')).toBe(true)
      expect(granteeShareCoversWikiPath(r, 'ideas')).toBe(true)
      expect(granteeShareCoversWikiPath(r, 'ideas2/foo.md')).toBe(false)
    })

    it('file share covers exact md path only', () => {
      const r = rowFile('x/plan.md')
      expect(granteeShareCoversWikiPath(r, 'x/plan.md')).toBe(true)
      expect(granteeShareCoversWikiPath(r, '/x/plan.md')).toBe(true)
      expect(granteeShareCoversWikiPath(r, 'x/other.md')).toBe(false)
      expect(granteeShareCoversWikiPath(r, 'x/plan.md.bak')).toBe(false)
    })
  })

  it('granteeCanReadOwnerWikiPath ORs multiple accepted shares', () => {
    const ownerId = 'usr_orrrrrrrrrrrrrrrrrrr'
    const granteeId = 'usr_or222222222222222222'
    const a = createShare({ ownerId, granteeEmail: 'or@x.com', pathPrefix: 'a/' })
    const b = createShare({ ownerId, granteeEmail: 'or@x.com', pathPrefix: 'b/' })
    acceptShare({ token: a.invite_token, granteeId, granteeEmail: 'or@x.com' })
    acceptShare({ token: b.invite_token, granteeId, granteeEmail: 'or@x.com' })
    expect(granteeCanReadOwnerWikiPath({ granteeId, ownerId, wikiRelPath: 'a/x.md' })).toBe(true)
    expect(granteeCanReadOwnerWikiPath({ granteeId, ownerId, wikiRelPath: 'b/y.md' })).toBe(true)
    expect(granteeCanReadOwnerWikiPath({ granteeId, ownerId, wikiRelPath: 'c/z.md' })).toBe(false)
  })

  it('pending invite does not grant read', () => {
    const ownerId = 'usr_pendrd11111111111111'
    const granteeId = 'usr_pendrd22222222222222'
    createShare({ ownerId, granteeEmail: 'pend@x.com', pathPrefix: 'pub/' })
    expect(
      granteeCanReadOwnerWikiPath({ granteeId, ownerId, wikiRelPath: 'pub/x.md' }),
    ).toBe(false)
  })

  it('file share row grants read only for that file via granteeCanReadOwnerWikiPath', () => {
    const ownerId = 'usr_fileacl1111111111111'
    const granteeId = 'usr_fileacl2222222222222'
    const row = createShare({
      ownerId,
      granteeEmail: 'f@f.com',
      targetKind: 'file',
      pathPrefix: 'notes/special.md',
    })
    acceptShare({ token: row.invite_token, granteeId, granteeEmail: 'f@f.com' })
    expect(
      granteeCanReadOwnerWikiPath({ granteeId, ownerId, wikiRelPath: 'notes/special.md' }),
    ).toBe(true)
    expect(
      granteeCanReadOwnerWikiPath({ granteeId, ownerId, wikiRelPath: 'notes/other.md' }),
    ).toBe(false)
  })
})
