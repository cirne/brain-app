import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let wikiRoot: string

beforeEach(async () => {
  wikiRoot = await mkdtemp(join(tmpdir(), 'wiki-wipe-'))
  process.env.WIKI_DIR = wikiRoot
})

afterEach(async () => {
  await rm(wikiRoot, { recursive: true, force: true })
  delete process.env.WIKI_DIR
})

describe('wikiDir', () => {
  it('wipeWikiContent clears wiki/ subtree and recreates empty dir (brain layout)', async () => {
    const wiki = join(wikiRoot, 'wiki')
    await mkdir(join(wiki, 'nested'), { recursive: true })
    await writeFile(join(wiki, 'me.md'), '# me', 'utf-8')
    await writeFile(join(wiki, 'nested', 'x.md'), 'x', 'utf-8')

    const { wipeWikiContent, wikiDir } = await import('./wikiDir.js')
    expect(wikiDir()).toBe(wiki)
    await wipeWikiContent()

    const names = await readdir(wiki)
    expect(names).toEqual([])
  })

  it('wipeWikiContent on flat layout removes files but keeps .git', async () => {
    await writeFile(join(wikiRoot, 'me.md'), '# me', 'utf-8')
    await mkdir(join(wikiRoot, '.git'), { recursive: true })
    await writeFile(join(wikiRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')

    const { wipeWikiContent, wikiDir } = await import('./wikiDir.js')
    expect(wikiDir()).toBe(wikiRoot)
    await wipeWikiContent()

    const names = (await readdir(wikiRoot)).sort()
    expect(names).toEqual(['.git'])
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(join(wikiRoot, '.git', 'HEAD'), 'utf-8')).toContain('refs/heads/main')
  })
})
