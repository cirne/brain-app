/**
 * `ensureUserPeoplePageSkeleton` must not block creating `index.md` if it throws.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('./profilingAgent.js', () => ({
  fetchRipmailWhoamiForProfiling: vi.fn().mockResolvedValue('x <test@x.com> x'),
  parseWhoamiProfileSubject: vi.fn().mockReturnValue({ displayName: 'Test', primaryEmail: 'test@x.com' }),
}))

vi.mock('../lib/userPeoplePage.js', () => ({
  ensureUserPeoplePageSkeleton: vi.fn().mockRejectedValue(new Error('simulated people page failure')),
}))

let wikiRoot: string

beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'wiki-scaffold-order-'))
  wikiRoot = join(home, 'wiki')
})

afterEach(async () => {
  await rm(join(wikiRoot, '..'), { recursive: true, force: true })
})

describe('ensureWikiVaultScaffoldForBuildout', () => {
  it('still creates index.md when account-holder people skeleton fails', async () => {
    const { ensureWikiVaultScaffoldForBuildout } = await import('./wikiBuildoutAgent.js')
    const ref = await ensureWikiVaultScaffoldForBuildout(wikiRoot)
    expect(ref).toBeNull()
    const raw = await readFile(join(wikiRoot, 'index.md'), 'utf-8')
    expect(raw).toContain('[[me]]')
  })
})
