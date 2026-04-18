import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let brainRoot: string

beforeEach(async () => {
  brainRoot = await mkdtemp(join(tmpdir(), 'brain-wipe-'))
  process.env.BRAIN_HOME = brainRoot
})

afterEach(async () => {
  await rm(brainRoot, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('wikiDir', () => {
  it('wipeWikiContent clears $BRAIN_HOME/wiki and keeps .git if present', async () => {
    const wiki = join(brainRoot, 'wiki')
    await mkdir(join(wiki, 'nested'), { recursive: true })
    await writeFile(join(wiki, 'me.md'), '# me', 'utf-8')
    await writeFile(join(wiki, 'nested', 'x.md'), 'x', 'utf-8')
    await mkdir(join(wiki, '.git'), { recursive: true })
    await writeFile(join(wiki, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8')

    const { wipeWikiContent, wikiDir } = await import('./wikiDir.js')
    expect(wikiDir()).toBe(wiki)
    await wipeWikiContent()

    const names = (await readdir(wiki)).sort()
    expect(names).toEqual(['.git'])
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(join(wiki, '.git', 'HEAD'), 'utf-8')).toContain('refs/heads/main')
  })

  it('wipeWikiContentExceptMeMd keeps root me.md and removes other pages', async () => {
    const wiki = join(brainRoot, 'wiki')
    await mkdir(join(wiki, 'people'), { recursive: true })
    await writeFile(join(wiki, 'me.md'), '# me', 'utf-8')
    await writeFile(join(wiki, 'people', 'bob.md'), '# Bob', 'utf-8')

    const { wipeWikiContentExceptMeMd, wikiDir } = await import('./wikiDir.js')
    expect(wikiDir()).toBe(wiki)
    await wipeWikiContentExceptMeMd()

    const names = (await readdir(wiki)).sort()
    expect(names).toEqual(['me.md'])
    expect(await readFile(join(wiki, 'me.md'), 'utf-8')).toContain('# me')
  })
})
