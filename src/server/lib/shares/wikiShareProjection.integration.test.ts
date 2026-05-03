import type { AgentToolResult } from '@mariozechner/pi-agent-core'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, readlink, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import {
  acceptShare,
  createShare,
  deleteWikiSharesForOwner,
  revokeShare,
  granteeCanReadOwnerWikiPath,
} from '@server/lib/shares/wikiSharesRepo.js'
import {
  syncWikiShareProjectionsForGrantee,
  removeWikiShareProjectionForShare,
} from '@server/lib/shares/wikiShareProjection.js'
import { migrateWikiToWikisMe, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { brainLayoutWikiDir, brainLayoutWikisDir } from '@server/lib/platform/brainLayout.js'
import { HANDLE_META_FILENAME } from '@server/lib/tenant/handleMeta.js'
import { createAgentTools } from '@server/agent/tools.js'
import { createWikiScopedPiTools } from '@server/agent/tools/wikiScopedFsTools.js'
import { createWikiFileManagementTools } from '@server/agent/tools/wikiFileManagementTools.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { joinToolResultText } from '@server/agent/agentTestUtils.js'
import { computePeerLinkPath } from '@server/lib/shares/wikiShareTargetPaths.js'
import type { WikiShareRow } from '@server/lib/shares/wikiSharesRepo.js'
import { rewriteOpenToolArgsIfNeeded } from '@server/lib/chat/rewriteAgentOpenWikiPath.js'

/** Invoke `move_file` in tests — `ToolDefinition.execute` is typed with extra pi-coding-agent args callers never provide at runtime here. */
function executeMoveDirect(
  tool: ReturnType<typeof createWikiFileManagementTools>['moveFile'],
  toolCallId: string,
  params: { from: string; to: string },
) {
  const run = tool.execute as (
    toolCallId: string,
    params: { from: string; to: string },
  ) => Promise<AgentToolResult<unknown>>
  return run(toolCallId, params)
}

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
      granteeId,
      granteeEmail: 'z@z.com',
      targetKind: 'file',
      pathPrefix: 'notes.md',
    })
    acceptShare({ token: row.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const linkPath = join(brainLayoutWikisDir(tenantHomeDir(granteeId)), '@alice', 'notes.md')
    expect((await readlink(linkPath)).replace(/\\/g, '/')).toMatch(/notes\.md$/)
    deleteWikiSharesForOwner(ownerId)
  })

  it('creates symlink at wikis/@alice/trips for directory share', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const row = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })
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
    const row = createShare({ ownerId, granteeId, granteeEmail: 'q@q.com', pathPrefix: 'x/' })
    acceptShare({ token: row.invite_token, granteeId })

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
    const row = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })
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
    const row = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })
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

  it('agent find discovers shared doc under @handle/, open rewrites path for client', async () => {
    const { ownerId, granteeId } = await tenantPair()
    await writeFile(
      join(tenantHomeDir(ownerId), HANDLE_META_FILENAME),
      JSON.stringify({
        userId: ownerId,
        handle: 'cirne',
        confirmedAt: new Date().toISOString(),
      }),
      'utf-8',
    )
    const ownerWiki = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ownerWiki, 'travel'), { recursive: true })
    await writeFile(join(ownerWiki, 'travel', 'virginia-trip-2026.md'), '# Virginia Trip\n\nPlanning notes.', 'utf-8')
    const row = createShare({ ownerId, granteeId, granteeEmail: 'grantee@test.com', pathPrefix: 'travel/' })
    acceptShare({ token: row.invite_token, granteeId })

    await syncWikiShareProjectionsForGrantee(granteeId)

    const granteeWikisRoot = brainLayoutWikisDir(tenantHomeDir(granteeId))

    await runWithTenantContextAsync(
      { tenantUserId: granteeId, workspaceHandle: '_', homeDir: tenantHomeDir(granteeId) },
      async () => {
        const tools = createAgentTools(granteeWikisRoot, {
          onlyToolNames: ['find', 'read', 'open'],
          includeLocalMessageTools: false,
        })
        const findTool = tools.find((t) => t.name === 'find')!
        const readTool = tools.find((t) => t.name === 'read')!
        const openTool = tools.find((t) => t.name === 'open')!

        const findResult = await findTool.execute('find-1', { pattern: '*virginia*.md' })
        const findText = joinToolResultText(findResult)
        expect(findText).toMatch(/@cirne\/travel\/virginia-trip-2026\.md/)

        const foundPath = '@cirne/travel/virginia-trip-2026.md'
        const readResult = await readTool.execute('read-1', { path: foundPath })
        expect(joinToolResultText(readResult)).toContain('Virginia Trip')

        const openArgs = { target: { type: 'wiki' as const, path: foundPath } }
        const rewrittenArgs = rewriteOpenToolArgsIfNeeded(granteeWikisRoot, openArgs)
        const rewrittenTarget = (rewrittenArgs as { target: { type: string; path: string } }).target
        expect(rewrittenTarget.path).toBe('@cirne/travel/virginia-trip-2026.md')
        expect(rewrittenTarget.type).toBe('wiki')

        const openResult = await openTool.execute('open-1', openArgs)
        expect(joinToolResultText(openResult)).toContain('Opening wiki')

        deleteWikiSharesForOwner(ownerId)
      },
    )
  })

  it('overlapping file then dir share: grantee reads c.md through dir projection', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'a', 'b'), { recursive: true })
    await writeFile(join(ow, 'a', 'b', 'c.md'), 'FILE_CONTENT', 'utf-8')

    const fileShare = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'z@z.com',
      targetKind: 'file',
      pathPrefix: 'a/b/c.md',
    })
    acceptShare({ token: fileShare.invite_token, granteeId })
    const dirShare = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'a/b/' })
    acceptShare({ token: dirShare.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)

    const wikis = brainLayoutWikisDir(tenantHomeDir(granteeId))
    const dirLink = join(wikis, '@alice', 'a', 'b')
    expect((await readlink(dirLink)).replace(/\\/g, '/')).toMatch(/b/)
    expect(await readFile(join(wikis, '@alice', 'a', 'b', 'c.md'), 'utf-8')).toBe('FILE_CONTENT')

    deleteWikiSharesForOwner(ownerId)
  })

  it('removeWikiShareProjectionForShare unlinks file share only; owner bytes unchanged', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await writeFile(join(ow, 'solo.md'), 'SOLO', 'utf-8')
    const fileShare = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'z@z.com',
      targetKind: 'file',
      pathPrefix: 'solo.md',
    })
    acceptShare({ token: fileShare.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)

    const ok = await removeWikiShareProjectionForShare({
      granteeTenantUserId: granteeId,
      share: fileShare as WikiShareRow,
    })
    expect(ok).toBe(true)
    expect(await readFile(join(ow, 'solo.md'), 'utf-8')).toBe('SOLO')

    deleteWikiSharesForOwner(ownerId)
  })

  it('overlapping: removeWikiShareProjectionForShare file row keeps owner file when dir share active', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'a', 'b'), { recursive: true })
    await writeFile(join(ow, 'a', 'b', 'c.md'), 'FILE_CONTENT', 'utf-8')

    const fileShare = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'z@z.com',
      targetKind: 'file',
      pathPrefix: 'a/b/c.md',
    })
    acceptShare({ token: fileShare.invite_token, granteeId })
    const dirShare = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'a/b/' })
    acceptShare({ token: dirShare.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)

    const ok = await removeWikiShareProjectionForShare({
      granteeTenantUserId: granteeId,
      share: fileShare as WikiShareRow,
    })
    expect(ok).toBe(true)
    expect(await readFile(join(ow, 'a', 'b', 'c.md'), 'utf-8')).toBe('FILE_CONTENT')

    const wikis = brainLayoutWikisDir(tenantHomeDir(granteeId))
    expect(await readFile(join(wikis, '@alice', 'a', 'b', 'c.md'), 'utf-8')).toBe('FILE_CONTENT')

    deleteWikiSharesForOwner(ownerId)
  })

  it('overlapping: dir share then file share uses wsh fallback for file projection', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'a', 'b'), { recursive: true })
    await writeFile(join(ow, 'a', 'b', 'c.md'), 'FC', 'utf-8')

    const dirShare = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'a/b/' })
    acceptShare({ token: dirShare.invite_token, granteeId })
    const fileShare = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'z@z.com',
      targetKind: 'file',
      pathPrefix: 'a/b/c.md',
    })
    acceptShare({ token: fileShare.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)

    const wikis = brainLayoutWikisDir(tenantHomeDir(granteeId))
    const fallback = join(wikis, '@alice', fileShare.id)
    expect((await readlink(fallback)).replace(/\\/g, '/')).toMatch(/c\.md$/)
    expect(await readFile(join(wikis, '@alice', 'a', 'b', 'c.md'), 'utf-8')).toBe('FC')
    expect(await readFile(join(ow, 'a', 'b', 'c.md'), 'utf-8')).toBe('FC')

    deleteWikiSharesForOwner(ownerId)
  })

  it('overlapping: revoke file share in DB then sync keeps dir access to c.md', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'a', 'b'), { recursive: true })
    await writeFile(join(ow, 'a', 'b', 'c.md'), 'FILE_CONTENT', 'utf-8')

    const fileShare = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'z@z.com',
      targetKind: 'file',
      pathPrefix: 'a/b/c.md',
    })
    acceptShare({ token: fileShare.invite_token, granteeId })
    const dirShare = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'a/b/' })
    acceptShare({ token: dirShare.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)

    revokeShare({ shareId: fileShare.id, ownerId })
    await syncWikiShareProjectionsForGrantee(granteeId)

    expect(granteeCanReadOwnerWikiPath({ granteeId, ownerId, wikiRelPath: 'a/b/c.md' })).toBe(true)
    expect(await readFile(join(ow, 'a', 'b', 'c.md'), 'utf-8')).toBe('FILE_CONTENT')

    deleteWikiSharesForOwner(ownerId)
  })

  it('overlapping: re-sync restores removed dir symlink when both shares active', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'a', 'b'), { recursive: true })
    await writeFile(join(ow, 'a', 'b', 'c.md'), 'x', 'utf-8')

    const fileShare = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'z@z.com',
      targetKind: 'file',
      pathPrefix: 'a/b/c.md',
    })
    acceptShare({ token: fileShare.invite_token, granteeId })
    const dirShare = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'a/b/' })
    acceptShare({ token: dirShare.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)

    const linkPath = join(brainLayoutWikisDir(tenantHomeDir(granteeId)), '@alice', 'a', 'b')
    await rm(linkPath, { force: true })
    await syncWikiShareProjectionsForGrantee(granteeId)
    expect(await readlink(linkPath)).toBeTruthy()

    deleteWikiSharesForOwner(ownerId)
  })

  it('owner deletes shared subtree; sync does not throw', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const row = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await rm(join(ow, 'trips'), { recursive: true, force: true })
    await expect(syncWikiShareProjectionsForGrantee(granteeId)).resolves.toBeUndefined()
    deleteWikiSharesForOwner(ownerId)
  })

  it('accept then revoke before first sync leaves no @peer on grantee', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const row = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })
    revokeShare({ shareId: row.id, ownerId })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(brainLayoutWikisDir(tenantHomeDir(granteeId)), '@alice'))).toBe(false)
  })

  it('reconcile removes projection after DB revoke though unlink was never run', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const row = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const wikis = brainLayoutWikisDir(tenantHomeDir(granteeId))
    expect(await readlink(join(wikis, '@alice', 'trips'))).toBeTruthy()

    revokeShare({ shareId: row.id, ownerId })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(wikis, '@alice'))).toBe(false)
  })

  it('write tool appends WARNING when path is under accepted outgoing dir share', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'trips'), { recursive: true })
    const row = createShare({ ownerId, granteeId, granteeEmail: 'peer@example.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })

    const ownerWikis = brainLayoutWikisDir(tenantHomeDir(ownerId))
    const { write } = createWikiScopedPiTools(ownerWikis, { wikiWriteShareHintOwnerId: ownerId })
    const res = await write.execute('w1', { path: 'me/trips/newdoc.md', content: '# Hello' })
    const text = joinToolResultText(res as AgentToolResult<unknown>)
    expect(text).toMatch(/WARNING:/i)
    expect(text).toContain('peer@example.com')

    deleteWikiSharesForOwner(ownerId)
  })

  it('move_file appends WARNING when destination is under accepted outgoing dir share', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'private'), { recursive: true })
    await mkdir(join(ow, 'trips'), { recursive: true })
    await writeFile(join(ow, 'private', 'draft.md'), '# d', 'utf-8')
    const row = createShare({ ownerId, granteeId, granteeEmail: 'peer@example.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })

    const ownerWikis = brainLayoutWikisDir(tenantHomeDir(ownerId))
    const { moveFile } = createWikiFileManagementTools(ownerWikis, { wikiWriteShareHintOwnerId: ownerId })
    const res = await executeMoveDirect(moveFile, 'm-share', {
      from: 'me/private/draft.md',
      to: 'me/trips/from-private.md',
    })
    const text = joinToolResultText(res as AgentToolResult<unknown>)
    expect(text).toMatch(/WARNING:/i)
    expect(text).toContain('peer@example.com')

    deleteWikiSharesForOwner(ownerId)
  })

  it('move_file omits WARNING when destination is outside shared prefixes', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'private'), { recursive: true })
    await mkdir(join(ow, 'archive'), { recursive: true })
    await writeFile(join(ow, 'private', 'draft.md'), '# d', 'utf-8')
    const row = createShare({ ownerId, granteeId, granteeEmail: 'peer@example.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })

    const ownerWikis = brainLayoutWikisDir(tenantHomeDir(ownerId))
    const { moveFile } = createWikiFileManagementTools(ownerWikis, { wikiWriteShareHintOwnerId: ownerId })
    const res = await executeMoveDirect(moveFile, 'm-private', {
      from: 'me/private/draft.md',
      to: 'me/archive/draft.md',
    })
    expect(joinToolResultText(res as AgentToolResult<unknown>)).not.toMatch(/WARNING:/i)

    deleteWikiSharesForOwner(ownerId)
  })

  it('write tool omits WARNING for path outside shared prefixes', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'private'), { recursive: true })
    const row = createShare({ ownerId, granteeId, granteeEmail: 'peer@example.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })

    const ownerWikis = brainLayoutWikisDir(tenantHomeDir(ownerId))
    const { write } = createWikiScopedPiTools(ownerWikis, { wikiWriteShareHintOwnerId: ownerId })
    const res = await write.execute('w2', { path: 'me/private/x.md', content: 'x' })
    expect(joinToolResultText(res as AgentToolResult<unknown>)).not.toMatch(/WARNING:/i)

    deleteWikiSharesForOwner(ownerId)
  })

  it('write tool appends WARNING for exact file share path', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'trips'), { recursive: true })
    await writeFile(join(ow, 'trips', 'plan.md'), 'old', 'utf-8')
    const row = createShare({
      ownerId,
      granteeId,
      granteeEmail: 'f@f.com',
      targetKind: 'file',
      pathPrefix: 'trips/plan.md',
    })
    acceptShare({ token: row.invite_token, granteeId })

    const ownerWikis = brainLayoutWikisDir(tenantHomeDir(ownerId))
    const { write } = createWikiScopedPiTools(ownerWikis, { wikiWriteShareHintOwnerId: ownerId })
    const res = await write.execute('w3', { path: 'me/trips/plan.md', content: '# replaced' })
    expect(joinToolResultText(res as AgentToolResult<unknown>)).toMatch(/WARNING:/i)
    expect(joinToolResultText(res as AgentToolResult<unknown>)).toContain('f@f.com')

    deleteWikiSharesForOwner(ownerId)
  })

  it('write tool rejects @peer paths before share hint', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'x'), { recursive: true })
    await writeFile(join(ow, 'x', 'f.md'), 'h', 'utf-8')
    const row = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'x/' })
    acceptShare({ token: row.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)

    const granteeWikis = brainLayoutWikisDir(tenantHomeDir(granteeId))
    const { write } = createWikiScopedPiTools(granteeWikis, { wikiWriteShareHintOwnerId: granteeId })
    await expect(write.execute('wx', { path: '@alice/x/nope.md', content: 'x' })).rejects.toThrow(
      /read-only|projection|Cannot write/i,
    )

    deleteWikiSharesForOwner(ownerId)
  })

  it('agent find on bare path not in me/ rewrites to @handle/ when unambiguous', async () => {
    const { ownerId, granteeId } = await tenantPair()
    await writeFile(
      join(tenantHomeDir(ownerId), HANDLE_META_FILENAME),
      JSON.stringify({
        userId: ownerId,
        handle: 'cirne',
        confirmedAt: new Date().toISOString(),
      }),
      'utf-8',
    )
    const ownerWiki = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ownerWiki, 'travel'), { recursive: true })
    await writeFile(join(ownerWiki, 'travel', 'trip.md'), 'SHARED', 'utf-8')
    const row = createShare({ ownerId, granteeId, granteeEmail: 'g@g.com', pathPrefix: 'travel/' })
    acceptShare({ token: row.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)

    const granteeWikisRoot = brainLayoutWikisDir(tenantHomeDir(granteeId))
    const granteeWikiMe = join(granteeWikisRoot, 'me')
    await mkdir(granteeWikiMe, { recursive: true })

    const openArgs = { target: { type: 'wiki' as const, path: 'travel/trip.md' } }
    const rewrittenArgs = rewriteOpenToolArgsIfNeeded(granteeWikisRoot, openArgs)
    const rewrittenTarget = (rewrittenArgs as { target: { type: string; path: string } }).target
    expect(rewrittenTarget.path).toBe('@cirne/travel/trip.md')

    deleteWikiSharesForOwner(ownerId)
  })

  it('reconcile removes junk files under @peer after sync runs twice', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const row = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const peerRoot = join(brainLayoutWikisDir(tenantHomeDir(granteeId)), '@alice')
    const junk = join(peerRoot, 'user-added-junk.txt')
    await writeFile(junk, 'garbage', 'utf-8')
    await syncWikiShareProjectionsForGrantee(granteeId)
    await expect(readFile(junk, 'utf-8')).rejects.toThrow()
    await syncWikiShareProjectionsForGrantee(granteeId)
    await expect(readFile(junk, 'utf-8')).rejects.toThrow()
    expect((await readlink(join(peerRoot, 'trips')))).toBeTruthy()
    deleteWikiSharesForOwner(ownerId)
  })

  it('accept two dir shares then revoke one leaves the other projection', async () => {
    const { ownerId, granteeId, ow } = await tenantPair()
    await mkdir(join(ow, 'ideas'), { recursive: true })
    await writeFile(join(ow, 'ideas', 'n.md'), 'idea', 'utf-8')
    const tripsRow = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    const ideasRow = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'ideas/' })
    acceptShare({ token: tripsRow.invite_token, granteeId })
    acceptShare({ token: ideasRow.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const peer = join(brainLayoutWikisDir(tenantHomeDir(granteeId)), '@alice')
    expect(await readlink(join(peer, 'trips'))).toBeTruthy()
    expect(await readlink(join(peer, 'ideas'))).toBeTruthy()

    revokeShare({ shareId: tripsRow.id, ownerId })
    await syncWikiShareProjectionsForGrantee(granteeId)
    await expect(readlink(join(peer, 'trips'))).rejects.toThrow()
    expect(await readlink(join(peer, 'ideas'))).toBeTruthy()

    deleteWikiSharesForOwner(ownerId)
  })

  it('second sync recreates directory share symlink after manual unlink', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const row = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)
    const linkPath = join(brainLayoutWikisDir(tenantHomeDir(granteeId)), '@alice', 'trips')
    expect((await readlink(linkPath)).length).toBeGreaterThan(0)
    await rm(linkPath, { recursive: false, force: true })
    await syncWikiShareProjectionsForGrantee(granteeId)
    expect((await readlink(linkPath)).length).toBeGreaterThan(0)
    deleteWikiSharesForOwner(ownerId)
  })

  it('read tool errors when shared owner file was deleted', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'gone'), { recursive: true })
    await writeFile(join(ow, 'gone', 'x.md'), 'bye', 'utf-8')
    const row = createShare({ ownerId, granteeId, granteeEmail: 'z@z.com', pathPrefix: 'gone/' })
    acceptShare({ token: row.invite_token, granteeId })
    await syncWikiShareProjectionsForGrantee(granteeId)
    await rm(join(ow, 'gone', 'x.md'), { force: true })

    const granteeWikis = brainLayoutWikisDir(tenantHomeDir(granteeId))
    const { read } = createWikiScopedPiTools(granteeWikis)
    await expect(read.execute('r1', { path: '@alice/gone/x.md' })).rejects.toThrow(/ENOENT|no such file|not found/i)

    deleteWikiSharesForOwner(ownerId)
  })

  it('edit tool appends share visibility WARNING like write', async () => {
    const { ownerId, granteeId } = await tenantPair()
    const ow = brainLayoutWikiDir(tenantHomeDir(ownerId))
    await mkdir(join(ow, 'trips'), { recursive: true })
    await writeFile(join(ow, 'trips', 'e.md'), 'old', 'utf-8')
    const row = createShare({ ownerId, granteeId, granteeEmail: 'peer@example.com', pathPrefix: 'trips/' })
    acceptShare({ token: row.invite_token, granteeId })

    const ownerWikis = brainLayoutWikisDir(tenantHomeDir(ownerId))
    const { edit } = createWikiScopedPiTools(ownerWikis, { wikiWriteShareHintOwnerId: ownerId })
    const res = await edit.execute('e1', {
      path: 'me/trips/e.md',
      edits: [{ oldText: 'old', newText: 'new' }],
    })
    const text = joinToolResultText(res as AgentToolResult<unknown>)
    expect(text).toMatch(/WARNING:/i)
    expect(text).toContain('peer@example.com')

    deleteWikiSharesForOwner(ownerId)
  })

})
