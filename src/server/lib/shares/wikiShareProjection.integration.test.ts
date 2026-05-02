import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, readlink, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import {
  acceptShare,
  createShare,
  deleteWikiSharesForOwner,
  revokeShare,
} from '@server/lib/shares/wikiSharesRepo.js'
import {
  syncWikiShareProjectionsForGrantee,
  removeWikiShareProjectionForShare,
} from '@server/lib/shares/wikiShareProjection.js'
import { migrateWikiToWikisMe, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { brainLayoutWikiDir, brainLayoutWikisDir } from '@server/lib/platform/brainLayout.js'
import { HANDLE_META_FILENAME } from '@server/lib/tenant/handleMeta.js'
import { createAgentTools } from '@server/agent/tools.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { joinToolResultText } from '@server/agent/agentTestUtils.js'
import { computePeerLinkPath } from '@server/lib/shares/wikiShareTargetPaths.js'
import type { WikiShareRow } from '@server/lib/shares/wikiSharesRepo.js'

describe('wiki share projection (wikis/@peer/)', () => {
  let tmp: string
  const prevData = process.env.BRAIN_DATA_ROOT
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'wsh-fs-'))
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

  async function tenantPair() {
    const ownerId = `usr_${'o'.repeat(20)}`
    const granteeId = `usr_${'p'.repeat(20)}`
    await mkdir(tenantHomeDir(ownerId), { recursive: true })
    await mkdir(tenantHomeDir(granteeId), { recursive: true })
    migrateWikiToWikisMe(tenantHomeDir(ownerId))
    migrateWikiToWikisMe(tenantHomeDir(granteeId))
    await writeFile(
      join(tenantHomeDir(ownerId), HANDLE_META_FILENAME),
      JSON.stringify({
        userId: ownerId,
        handle: 'alice',
        confirmedAt: new Date().toISOString(),
      }),
      'utf-8',
    )
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'trips', 'virginia'), { recursive: true })
    await writeFile(join(ow, 'trips', 'virginia', 'trip.md'), 'SECRET_TRIP', 'utf-8')
    return { ownerId, granteeId, ow }
  }

  it('creates symlink at wikis/@alice/notes.md for file share', async () => {
    const { ownerId, granteeId, ow } = await tenantPair()
    await writeFile(join(ow, 'notes.md'), 'NOTE', 'utf-8')
    const row = createShare({
      ownerId,
      granteeEmail: 'z@z.com',
      targetKind: 'file',
      pathPrefix: 'notes.md',
    })
    acceptShare({ token: row.invite_token, granteeId, granteeEmail: 'z@z.com' })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const linkPath = join(brainLayoutWikisDir(tenantHomeDir(granteeId)), '@alice', 'notes.md')
    expect((await readlink(linkPath)).replace(/\\/g, '/')).toMatch(/notes\.md$/)
    deleteWikiSharesForOwner(ownerId)
  })

  it('creates symlink at wikis/@alice/trips for directory share', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const row = createShare({ ownerId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId, granteeEmail: 'z@z.com' })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const linkPath = join(brainLayoutWikisDir(tenantHomeDir(granteeId)), '@alice', 'trips')
    const target = await readlink(linkPath)
    expect(target.replace(/\\/g, '/')).toMatch(/trips/)

    revokeShare({ shareId: row.id, ownerId })
    await syncWikiShareProjectionsForGrantee(granteeId)
    deleteWikiSharesForOwner(ownerId)
  })

  it('agent read works on @carol shared path under wikis/; edit blocked', async () => {
    const { ownerId, granteeId } = await tenantPair()
    await writeFile(
      join(tenantHomeDir(ownerId), HANDLE_META_FILENAME),
      JSON.stringify({
        userId: ownerId,
        handle: 'carol',
        confirmedAt: new Date().toISOString(),
      }),
      'utf-8',
    )
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'x'), { recursive: true })
    await writeFile(join(ow, 'x', 'f.md'), 'hi', 'utf-8')
    const row = createShare({ ownerId, granteeEmail: 'q@q.com', pathPrefix: 'x/' })
    acceptShare({ token: row.invite_token, granteeId, granteeEmail: 'q@q.com' })

    await syncWikiShareProjectionsForGrantee(granteeId)

    const wikisRoot = brainLayoutWikisDir(tenantHomeDir(granteeId))

    await runWithTenantContextAsync(
      { tenantUserId: granteeId, workspaceHandle: '_', homeDir: tenantHomeDir(granteeId) },
      async () => {
        const tools = createAgentTools(wikisRoot, {
          onlyToolNames: ['read', 'edit'],
          includeLocalMessageTools: false,
        })
        const read = tools.find((t) => t.name === 'read')!
        const rr = await read.execute('tid', { path: '@carol/x/f.md' })
        expect(joinToolResultText(rr)).toContain('hi')

        const edit = tools.find((t) => t.name === 'edit')!
        await expect(
          edit.execute('tid', { path: '@carol/x/f.md', edits: [{ oldText: 'hi', newText: 'bye' }] }),
        ).rejects.toThrow(/read-only|projection|Cannot edit/i)

        deleteWikiSharesForOwner(ownerId)
      },
    )
  })

  it('removeWikiShareProjectionForShare runs before revoke invariant', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const row = createShare({ ownerId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId, granteeEmail: 'z@z.com' })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const linkPath = join(brainLayoutWikisDir(tenantHomeDir(granteeId)), '@alice', 'trips')
    expect(await readlink(linkPath)).toBeTruthy()

    const ok = await removeWikiShareProjectionForShare({ granteeTenantUserId: granteeId, share: row as WikiShareRow })
    expect(ok).toBe(true)
    await expect(lstat(linkPath)).rejects.toMatchObject({ code: 'ENOENT' })

    revokeShare({ shareId: row.id, ownerId })
    deleteWikiSharesForOwner(ownerId)
  })

  it('computePeerLinkPath encodes nested dir share', () => {
    const share = {
      id: 'wsh_x',
      owner_id: 'u',
      grantee_email: 'a@a.com',
      grantee_id: 'g',
      path_prefix: 'trips/virginia/',
      target_kind: 'dir' as const,
      invite_token: 't',
      created_at_ms: 1,
      accepted_at_ms: 1,
      revoked_at_ms: null,
    }
    expect(computePeerLinkPath('@alice', share)).toBe('@alice/trips/virginia')
  })

  it('reconcile restores deleted symlink', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const row = createShare({ ownerId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId, granteeEmail: 'z@z.com' })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const linkPath = join(brainLayoutWikisDir(tenantHomeDir(granteeId)), '@alice', 'trips')
    await rm(linkPath, { force: true })
    await syncWikiShareProjectionsForGrantee(granteeId)
    expect(await readlink(linkPath)).toBeTruthy()
    deleteWikiSharesForOwner(ownerId)
  })

  it('migrateWikiToWikisMe moves legacy wiki/ to wikis/me/', async () => {
    const tid = `usr_${'m'.repeat(20)}`
    const home = tenantHomeDir(tid)
    await mkdir(join(home, 'wiki'), { recursive: true })
    await writeFile(join(home, 'wiki', 'a.md'), 'x', 'utf-8')
    migrateWikiToWikisMe(home)
    const { readFile } = await import('node:fs/promises')
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(home, 'wiki'))).toBe(false)
    expect(await readFile(join(home, 'wikis', 'me', 'a.md'), 'utf-8')).toBe('x')
  })

})
