/**
 * `ensureUserPeoplePageSkeleton` must not block creating `index.md` if it throws.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

vi.mock('./profilingAgent.js', () => ({
  fetchRipmailWhoamiForProfiling: vi.fn().mockResolvedValue('x <test@x.com> x'),
  parseWhoamiProfileSubject: vi.fn().mockReturnValue({ displayName: 'Test', primaryEmail: 'test@x.com' }),
}))

vi.stubEnv('BRAIN_STARTER_WIKI_BUNDLE', join(repoRoot, 'assets', 'starter-wiki'))

vi.mock('@server/lib/wiki/userPeoplePage.js', () => ({
  ensureUserPeoplePageSkeleton: vi.fn().mockRejectedValue(new Error('simulated people page failure')),
}))

let wikiRoot: string

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'wiki-scaffold-order-'))
  wikiRoot = join(home, 'wiki')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(join(wikiRoot, '..'), { recursive: true, force: true })
})

describe('ensureWikiVaultScaffoldForBuildout', () => {
  it('still creates index.md when account-holder people skeleton fails', async () => {
    const { ensureWikiVaultScaffoldForBuildout } = await import('./wikiBuildoutAgent.js')
    const ref = await ensureWikiVaultScaffoldForBuildout(wikiRoot)
    expect(ref).toBeNull()
    const raw = await readFile(join(wikiRoot, 'index.md'), 'utf-8')
    expect(raw).toContain('[[me]]')
    if (existsSync(join(repoRoot, 'assets', 'starter-wiki'))) {
      expect(existsSync(join(wikiRoot, 'people/template.md'))).toBe(true)
      expect(existsSync(join(wikiRoot, 'travel/index.md'))).toBe(true)
    }
  })
})
