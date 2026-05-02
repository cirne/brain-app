import { describe, it, expect, beforeEach } from 'vitest'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { wikiVaultGlobViaWalk } from './wikiVaultSymlinkGlob.js'

describe('wikiVaultGlobViaWalk', () => {
  let wikiRoot: string
  let otherRoot: string
  let tmpBase: string
  const peerSeg = '@alice'

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), 'wiki-glob-'))
    wikiRoot = join(tmpBase, 'grantee-wikis')
    otherRoot = join(tmpBase, 'owner-wiki')
    await mkdir(join(wikiRoot, peerSeg), { recursive: true })
    await mkdir(join(wikiRoot, 'me'), { recursive: true })
    await mkdir(otherRoot, { recursive: true })
  })

  it('matches peer share symlink via target basename when path is outside grantee wiki root', async () => {
    const targetFile = join(otherRoot, 'virginia-trip-2026.md')
    await writeFile(targetFile, '# Virginia Trip', 'utf-8')
    const linkAbs = join(wikiRoot, peerSeg, 'virginia.md')
    await symlink(targetFile, linkAbs)

    const hits = await wikiVaultGlobViaWalk({
      pattern: '*virginia*',
      searchPathAbs: wikiRoot,
      limit: 50,
    })

    expect(hits).toContain(`${peerSeg}/virginia.md`)
  })

  it('still lists markdown under me/ beside peer symlinks', async () => {
    await writeFile(join(wikiRoot, 'me', 'local.md'), 'x', 'utf-8')
    const targetFile = join(otherRoot, 'virginia-trip-2026.md')
    await writeFile(targetFile, 'y', 'utf-8')
    await symlink(targetFile, join(wikiRoot, peerSeg, 'leaf.md'))

    const hits = await wikiVaultGlobViaWalk({
      pattern: '*.md',
      searchPathAbs: wikiRoot,
      limit: 50,
    })

    expect(hits).toContain('me/local.md')
  })

  it('caseSensitive true requires glob pattern case to match filename', async () => {
    await writeFile(join(wikiRoot, 'me', 'UPPER.md'), 'x', 'utf-8')
    const ins = await wikiVaultGlobViaWalk({
      pattern: '*upper*',
      searchPathAbs: wikiRoot,
      limit: 50,
    })
    expect(ins.some((h) => h.endsWith('UPPER.md'))).toBe(true)
    const sens = await wikiVaultGlobViaWalk({
      pattern: '*upper*',
      searchPathAbs: wikiRoot,
      limit: 50,
      caseSensitive: true,
    })
    expect(sens.length).toBe(0)
  })
})
