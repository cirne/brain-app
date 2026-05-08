import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rewriteOpenToolArgsIfNeeded, rewriteOpenWikiTargetForUnifiedTree } from './rewriteAgentOpenWikiPath.js'

let base: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'open-rewrite-'))
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('rewriteOpenWikiTargetForUnifiedTree', () => {
  async function layoutFlatWiki() {
    await mkdir(join(base, 'travel'), { recursive: true })
    await writeFile(join(base, 'travel', 'va.md'), '# hi', 'utf-8')
  }

  async function layoutLegacyMe() {
    await mkdir(join(base, 'me', 'travel'), { recursive: true })
    await writeFile(join(base, 'me', 'travel', 'va.md'), '# hi', 'utf-8')
  }

  it('leaves @handle paths unchanged', async () => {
    await layoutFlatWiki()
    const t = { type: 'wiki' as const, path: '@cirne/travel/va.md' }
    expect(rewriteOpenWikiTargetForUnifiedTree(base, t)).toEqual(t)
  })

  it('does not rewrite bare path when already wiki-root-relative', async () => {
    await layoutFlatWiki()
    const t = { type: 'wiki' as const, path: 'travel/va.md' }
    expect(rewriteOpenWikiTargetForUnifiedTree(base, t)).toEqual(t)
  })

  it('strips me/ when file exists at wiki root', async () => {
    await layoutFlatWiki()
    const out = rewriteOpenWikiTargetForUnifiedTree(base, {
      type: 'wiki',
      path: 'me/travel/va.md',
    }) as { path: string }
    expect(out.path).toBe('travel/va.md')
  })

  it('does not rewrite when path missing', async () => {
    await layoutFlatWiki()
    const t = { type: 'wiki' as const, path: 'missing/x.md' }
    expect(rewriteOpenWikiTargetForUnifiedTree(base, t)).toEqual(t)
  })

  it('accepts legacy vault root (wikis/me) same as unified wikis/ root', async () => {
    await layoutLegacyMe()
    const vault = join(base, 'me')
    const out = rewriteOpenWikiTargetForUnifiedTree(vault, {
      type: 'wiki',
      path: 'travel/va.md',
    }) as { path: string }
    expect(out.path).toBe('travel/va.md')
  })

  it('rewrites full open args', async () => {
    await layoutFlatWiki()
    const args = { target: { type: 'wiki' as const, path: 'me/travel/va.md' } }
    const out = rewriteOpenToolArgsIfNeeded(base, args) as typeof args
    expect(out.target).toEqual({ type: 'wiki', path: 'travel/va.md' })
  })
})
