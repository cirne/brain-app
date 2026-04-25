import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let brainHome: string
let savedWikiRoot: string | undefined
let extraWikiParent: string | undefined

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'brain-home-wipe-'))
  extraWikiParent = undefined
  process.env.BRAIN_HOME = brainHome
  savedWikiRoot = process.env.BRAIN_WIKI_ROOT
  delete process.env.BRAIN_WIKI_ROOT
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  if (extraWikiParent) {
    await rm(extraWikiParent, { recursive: true, force: true })
  }
  delete process.env.BRAIN_HOME
  if (savedWikiRoot === undefined) delete process.env.BRAIN_WIKI_ROOT
  else process.env.BRAIN_WIKI_ROOT = savedWikiRoot
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

  it('removes split wiki when BRAIN_WIKI_ROOT is outside BRAIN_HOME', async () => {
    extraWikiParent = await mkdtemp(join(tmpdir(), 'wiki-par-'))
    process.env.BRAIN_WIKI_ROOT = extraWikiParent
    const wikiDir = join(extraWikiParent, 'wiki')
    await mkdir(wikiDir, { recursive: true })
    await writeFile(join(wikiDir, 'p.md'), 'p', 'utf-8')

    const { wipeBrainHomeContents } = await import('@server/lib/platform/brainHome.js')
    await wipeBrainHomeContents()

    expect(existsSync(wikiDir)).toBe(false)
  })
})
