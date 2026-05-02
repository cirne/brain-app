import { describe, it, expect, beforeEach } from 'vitest'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  wikiFindGlobAbsolutePaths,
  tryWikiFindViaFdFollow,
  wikiFindDisplayRelPosixFromToolsRoot,
} from './wikiFindGlob.js'

describe('wikiFindDisplayRelPosixFromToolsRoot', () => {
  it('returns @peer/rel for files under a peer directory', () => {
    const root = join('/', 'tmp', 'wikis')
    const hit = join(root, '@cirne', 'travel', 'trip.md')
    expect(wikiFindDisplayRelPosixFromToolsRoot(root, hit)).toBe('@cirne/travel/trip.md')
  })

  it('falls back to logical prefix when relative would use ..', () => {
    const root = '/tmp/wikis'
    const hit = '/tmp/wikis/@cirne/x.md'
    expect(wikiFindDisplayRelPosixFromToolsRoot(root, hit)).toBe('@cirne/x.md')
  })
})

function hasFdOnPath(): boolean {
  for (const bin of ['fd', 'fdfind']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf-8' })
    if (!r.error && r.status === 0) return true
  }
  return false
}

describe('wikiFindGlobAbsolutePaths', () => {
  let wikiRoot: string
  let otherRoot: string
  let tmpBase: string
  const peerSeg = '@alice'

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), 'wiki-find-'))
    wikiRoot = join(tmpBase, 'grantee-wikis')
    otherRoot = join(tmpBase, 'owner-wiki')
    await mkdir(join(wikiRoot, peerSeg), { recursive: true })
    await mkdir(join(wikiRoot, 'me'), { recursive: true })
    await mkdir(otherRoot, { recursive: true })
  })

  it('returns absolute paths via walk fallback (peer symlink + me/)', async () => {
    await writeFile(join(wikiRoot, 'me', 'local.md'), 'x', 'utf-8')
    const targetFile = join(otherRoot, 'virginia-trip-2026.md')
    await writeFile(targetFile, 'y', 'utf-8')
    await symlink(targetFile, join(wikiRoot, peerSeg, 'leaf.md'))

    const hits = await wikiFindGlobAbsolutePaths({
      pattern: '*virginia*',
      searchPathAbs: wikiRoot,
      limit: 50,
    })

    const leaf = join(wikiRoot, peerSeg, 'leaf.md')
    expect(hits.some((h) => h === leaf)).toBe(true)
    expect(hits.every((h) => join(h, '').startsWith(tmpBase))).toBe(true)
  })

  it.skipIf(!hasFdOnPath())('tryWikiFindViaFdFollow uses fd when available', async () => {
    await writeFile(join(wikiRoot, 'me', 'fd-probe.md'), 'p', 'utf-8')
    const hits = tryWikiFindViaFdFollow({
      pattern: 'fd-probe.md',
      searchPathAbs: wikiRoot,
      limit: 20,
      ignore: ['**/node_modules/**', '**/.git/**'],
    })
    expect(hits).not.toBeNull()
    expect(hits!.some((h) => h.includes('fd-probe.md'))).toBe(true)
  })
})
