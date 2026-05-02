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
  async function layoutMeOnly() {
    await mkdir(join(base, 'me', 'travel'), { recursive: true })
    await writeFile(join(base, 'me', 'travel', 'va.md'), '# hi', 'utf-8')
  }

  async function layoutPeerOnly() {
    await mkdir(join(base, 'me'), { recursive: true })
    await mkdir(join(base, '@cirne', 'travel'), { recursive: true })
    await writeFile(join(base, '@cirne', 'travel', 'va.md'), '# peer', 'utf-8')
  }

  async function layoutBothSameRel() {
    await mkdir(join(base, 'me', 'travel'), { recursive: true })
    await writeFile(join(base, 'me', 'travel', 'va.md'), '# me', 'utf-8')
    await mkdir(join(base, '@cirne', 'travel'), { recursive: true })
    await writeFile(join(base, '@cirne', 'travel', 'va.md'), '# peer', 'utf-8')
  }

  it('leaves @handle paths unchanged', async () => {
    await layoutPeerOnly()
    const t = { type: 'wiki' as const, path: '@cirne/travel/va.md' }
    expect(rewriteOpenWikiTargetForUnifiedTree(base, t)).toEqual(t)
  })

  it('prefixes bare path with me/ when file exists only in personal vault', async () => {
    await layoutMeOnly()
    const out = rewriteOpenWikiTargetForUnifiedTree(base, { type: 'wiki', path: 'travel/va.md' }) as {
      path: string
    }
    expect(out.path).toBe('me/travel/va.md')
  })

  it('rewrites bare path to @peer when file exists only under one projection', async () => {
    await layoutPeerOnly()
    const out = rewriteOpenWikiTargetForUnifiedTree(base, { type: 'wiki', path: 'travel/va.md' }) as {
      path: string
    }
    expect(out.path).toBe('@cirne/travel/va.md')
  })

  it('rewrites wrong me/ path when file exists only on peer', async () => {
    await layoutPeerOnly()
    const out = rewriteOpenWikiTargetForUnifiedTree(base, {
      type: 'wiki',
      path: 'me/travel/va.md',
    }) as { path: string }
    expect(out.path).toBe('@cirne/travel/va.md')
  })

  it('does not rewrite when same relative path exists in me and a peer', async () => {
    await layoutBothSameRel()
    const t = { type: 'wiki' as const, path: 'travel/va.md' }
    expect(rewriteOpenWikiTargetForUnifiedTree(base, t)).toEqual(t)
  })

  it('rewrites full open args', async () => {
    await layoutPeerOnly()
    const args = { target: { type: 'wiki', path: 'travel/va.md' } }
    const out = rewriteOpenToolArgsIfNeeded(base, args) as typeof args
    expect(out.target.path).toBe('@cirne/travel/va.md')
  })
})
