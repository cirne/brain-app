import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { createShare, listSharesForOwner } from '@server/lib/shares/wikiSharesRepo.js'
import { executeTenantSoftReset } from './tenantSoftReset.js'
import {
  brainLayoutChatsDir,
  brainLayoutRipmailDir,
  brainLayoutWikiDir,
  brainLayoutCacheDir,
  brainLayoutVarDir,
} from '@server/lib/platform/brainLayout.js'

const mockEnsureWikiVaultScaffold = vi.hoisted(() => vi.fn(async () => null))

vi.mock('@server/lib/wiki/wikiVaultScaffold.js', () => ({
  ensureWikiVaultScaffold: mockEnsureWikiVaultScaffold,
}))

describe('tenantSoftReset', () => {
  let tenantHome: string
  let globalRoot: string
  const tenantUserId = 'usr_softreset_test_user000'
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH

  beforeEach(async () => {
    mockEnsureWikiVaultScaffold.mockClear()
    tenantHome = await mkdtemp(join(tmpdir(), 'brain-softrst-'))
    globalRoot = await mkdtemp(join(tmpdir(), 'brain-global-softrst-'))
    process.env.BRAIN_GLOBAL_SQLITE_PATH = join(globalRoot, 'global.sqlite')
    closeBrainGlobalDbForTests()

    await mkdir(brainLayoutWikiDir(tenantHome), { recursive: true })
    await writeFile(join(brainLayoutWikiDir(tenantHome), 'old.md'), '# hi\n')
    await mkdir(brainLayoutChatsDir(tenantHome), { recursive: true })
    await writeFile(join(brainLayoutChatsDir(tenantHome), '99-sess.json'), '{}')
    await mkdir(join(brainLayoutChatsDir(tenantHome), 'onboarding'), { recursive: true })
    await writeFile(join(brainLayoutChatsDir(tenantHome), 'onboarding', 'wiki-buildout-state.json'), '{}')
    await mkdir(brainLayoutRipmailDir(tenantHome), { recursive: true })
    await writeFile(join(brainLayoutRipmailDir(tenantHome), 'keep.sqlite'), '')
    await mkdir(brainLayoutVarDir(tenantHome), { recursive: true })
    await writeFile(join(brainLayoutVarDir(tenantHome), 'wiki-edits.jsonl'), '')
    await mkdir(brainLayoutCacheDir(tenantHome), { recursive: true })
    await writeFile(join(brainLayoutCacheDir(tenantHome), 'wiki-dir-icons.json'), '{}')
    await mkdir(join(tenantHome, 'background', 'runs'), { recursive: true })
    await writeFile(join(tenantHome, 'background', 'runs', 'x.json'), '{}')
    await mkdir(join(tenantHome, 'your-wiki'), { recursive: true })
    await writeFile(join(tenantHome, 'your-wiki', 'state.json'), '{}')

    createShare({
      ownerId: tenantUserId,
      granteeEmail: 'gr@g.com',
      pathPrefix: 'topics',
    })
    expect(listSharesForOwner(tenantUserId)).toHaveLength(1)
  })

  afterEach(async () => {
    closeBrainGlobalDbForTests()
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    await rm(tenantHome, { recursive: true, force: true })
    await rm(globalRoot, { recursive: true, force: true })
  })

  it('clears wiki/chats/caches/background/your-wiki, keeps ripmail, clears wiki shares, sets onboarding', async () => {
    await runWithTenantContextAsync(
      { tenantUserId, workspaceHandle: 'ws', homeDir: tenantHome },
      async () => executeTenantSoftReset(tenantUserId),
    )

    expect(existsSync(join(brainLayoutRipmailDir(tenantHome), 'keep.sqlite'))).toBe(true)
    expect(existsSync(join(brainLayoutWikiDir(tenantHome), 'old.md'))).toBe(false)
    const wikiEntries = await readdir(brainLayoutWikiDir(tenantHome))
    expect(wikiEntries).toEqual([])

    const chatFiles = await readdir(brainLayoutChatsDir(tenantHome))
    expect(chatFiles).toEqual(['onboarding.json'])
    const onboardingRaw = await readFile(join(brainLayoutChatsDir(tenantHome), 'onboarding.json'), 'utf-8')
    const onboarding = JSON.parse(onboardingRaw) as { state: string }
    expect(onboarding.state).toBe('onboarding-agent')

    expect(existsSync(join(tenantHome, 'background'))).toBe(false)
    expect(existsSync(join(tenantHome, 'your-wiki'))).toBe(false)
    expect(existsSync(join(brainLayoutVarDir(tenantHome), 'wiki-edits.jsonl'))).toBe(false)
    expect(listSharesForOwner(tenantUserId)).toHaveLength(0)
    expect(mockEnsureWikiVaultScaffold).toHaveBeenCalledOnce()
  })
})
