import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { brainLayoutRipmailDir } from './brainLayout.js'

let brainHome: string
let savedWikiRoot: string | undefined

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'brain-home-wipe-'))
  process.env.BRAIN_HOME = brainHome
  savedWikiRoot = process.env.BRAIN_WIKI_ROOT
  delete process.env.BRAIN_WIKI_ROOT
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  if (savedWikiRoot === undefined) delete process.env.BRAIN_WIKI_ROOT
  else process.env.BRAIN_WIKI_ROOT = savedWikiRoot
})

describe('brainWikiParentRoot', () => {
  let bh: string
  beforeEach(async () => {
    bh = await mkdtemp(join(tmpdir(), 'brain-wiki-parent-'))
    process.env.BRAIN_HOME = bh
  })
  afterEach(async () => {
    await rm(bh, { recursive: true, force: true }).catch(() => {})
    delete process.env.BRAIN_HOME
    delete process.env.BRAIN_WIKI_ROOT
    vi.resetModules()
  })

  it('uses BRAIN_WIKI_ROOT when set (eval isolated vault)', async () => {
    process.env.BRAIN_WIKI_ROOT = join(bh, 'case-vault')
    const { brainWikiParentRoot } = await import('@server/lib/platform/brainHome.js')
    expect(brainWikiParentRoot()).toBe(join(bh, 'case-vault'))
  })
})

describe('wipeBrainHomeContents', () => {
  it('removes every top-level entry; keeps empty root', async () => {
    await mkdir(join(brainHome, 'wiki'), { recursive: true })
    await writeFile(join(brainHome, 'loose.txt'), 'x', 'utf-8')
    await mkdir(join(brainHome, 'extra'), { recursive: true })
    const { wipeBrainHomeContents } = await import('@server/lib/platform/brainHome.js')
    await wipeBrainHomeContents()
    expect(await readdir(brainHome)).toEqual([])
  })

  it('no-op when brain home does not exist', async () => {
    process.env.BRAIN_HOME = join(tmpdir(), `missing-brain-${Date.now()}`)
    const { wipeBrainHomeContents } = await import('@server/lib/platform/brainHome.js')
    await expect(wipeBrainHomeContents()).resolves.toBeUndefined()
  })

  it('removes wiki under tenant home (wiki lives inside BRAIN_HOME in MT layout)', async () => {
    const wikiDir = join(brainHome, 'wiki')
    await mkdir(wikiDir, { recursive: true })
    await writeFile(join(wikiDir, 'p.md'), 'p', 'utf-8')

    const { wipeBrainHomeContents } = await import('@server/lib/platform/brainHome.js')
    await wipeBrainHomeContents()

    expect(existsSync(wikiDir)).toBe(false)
  })
})

describe('ripmailHomeForBrain', () => {
  let bh: string
  let prevRipmail: string | undefined

  beforeEach(async () => {
    bh = await mkdtemp(join(tmpdir(), 'brain-ripmail-home-'))
    process.env.BRAIN_HOME = bh
    prevRipmail = process.env.RIPMAIL_HOME
    process.env.RIPMAIL_HOME = '/this/path/is/ignored/by/brain'
  })

  afterEach(async () => {
    await rm(bh, { recursive: true, force: true }).catch(() => {})
    delete process.env.BRAIN_HOME
    if (prevRipmail === undefined) delete process.env.RIPMAIL_HOME
    else process.env.RIPMAIL_HOME = prevRipmail
  })

  it('ignores RIPMAIL_HOME and derives ripmail dir from BRAIN_HOME layout', async () => {
    const { ripmailHomeForBrain, ripmailProcessEnv } = await import('@server/lib/platform/brainHome.js')
    expect(ripmailHomeForBrain()).toBe(brainLayoutRipmailDir(bh))
    expect(ripmailProcessEnv().RIPMAIL_HOME).toBe(brainLayoutRipmailDir(bh))
  })
})
