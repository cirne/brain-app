import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import {
  vaultRelPathFromMeToolPath,
  buildWikiWriteShareVisibilityHint,
} from './wikiScopedFsTools.js'
import {
  acceptShare,
  createShare,
  deleteWikiSharesForOwner,
} from '@server/lib/shares/wikiSharesRepo.js'
import { migrateWikiToWikisMe, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'

describe('wikiScopedFsTools share hints', () => {
  it('vaultRelPathFromMeToolPath strips me/ prefix', () => {
    expect(vaultRelPathFromMeToolPath('me/trips/a.md')).toBe('trips/a.md')
    expect(vaultRelPathFromMeToolPath('./me/foo/bar.md')).toBe('foo/bar.md')
    expect(vaultRelPathFromMeToolPath('me')).toBe('')
    expect(vaultRelPathFromMeToolPath('@alice/x.md')).toBeNull()
  })

  describe('buildWikiWriteShareVisibilityHint with global DB', () => {
    let tmp: string
    const prevData = process.env.BRAIN_DATA_ROOT
    const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH

    beforeEach(async () => {
      tmp = await mkdtemp(join(tmpdir(), 'wsh-hint-'))
      process.env.BRAIN_DATA_ROOT = tmp
      process.env.BRAIN_GLOBAL_SQLITE_PATH = join(tmp, '.global', 'brain-global.sqlite')
      closeBrainGlobalDbForTests()
    })

    afterEach(async () => {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
      closeBrainGlobalDbForTests()
      if (prevData !== undefined) process.env.BRAIN_DATA_ROOT = prevData
      else delete process.env.BRAIN_DATA_ROOT
      if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
      else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    })

    it('returns hint when an accepted share covers the path', async () => {
      const ownerId = `usr_${'o'.repeat(20)}`
      const granteeId = `usr_${'g'.repeat(20)}`
      await mkdir(tenantHomeDir(ownerId), { recursive: true })
      migrateWikiToWikisMe(tenantHomeDir(ownerId))
      const row = createShare({ ownerId, granteeId, granteeEmail: 'p@p.com', pathPrefix: 'trips/' })
      acceptShare({ token: row.invite_token, granteeId })
      const hint = buildWikiWriteShareVisibilityHint(ownerId, 'trips/new.md')
      expect(hint).toBeTruthy()
      expect(hint).toContain('WARNING')
      expect(hint).toContain('p@p.com')
      deleteWikiSharesForOwner(ownerId)
    })

    it('returns null when no accepted share covers the path', async () => {
      const ownerId = `usr_${'n'.repeat(20)}`
      const granteeId = `usr_${'h'.repeat(20)}`
      await mkdir(tenantHomeDir(ownerId), { recursive: true })
      createShare({ ownerId, granteeId, granteeEmail: 'p@p.com', pathPrefix: 'trips/' })
      expect(buildWikiWriteShareVisibilityHint(ownerId, 'private/x.md')).toBeNull()
      deleteWikiSharesForOwner(ownerId)
    })
  })
})
