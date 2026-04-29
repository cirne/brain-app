import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { shouldSkipWikiTouchUpCheapCheck } from './wikiTouchUpCheapSkip.js'

let wikiRoot: string

beforeEach(async () => {
  wikiRoot = await mkdtemp(join(tmpdir(), 'wiki-cheap-skip-'))
})

afterEach(async () => {
  await rm(wikiRoot, { recursive: true, force: true })
})

describe('shouldSkipWikiTouchUpCheapCheck', () => {
  it('returns false when anchor text contains Obsidian [[wikilinks]]', async () => {
    await mkdir(join(wikiRoot, 'people'), { recursive: true })
    await writeFile(join(wikiRoot, 'people/x.md'), 'See [[topics/y]]', 'utf-8')

    await expect(
      shouldSkipWikiTouchUpCheapCheck(wikiRoot, ['people/x.md']),
    ).resolves.toBe(false)
  })

  it('returns false when anchor file is missing (cleanup still needed)', async () => {
    await mkdir(join(wikiRoot, 'people'), { recursive: true })
    await expect(
      shouldSkipWikiTouchUpCheapCheck(wikiRoot, ['people/missing.md']),
    ).resolves.toBe(false)
  })

  it('returns false when anchor path escapes wiki', async () => {
    await expect(
      shouldSkipWikiTouchUpCheapCheck(wikiRoot, ['../../../../etc/passwd']),
    ).resolves.toBe(false)
  })

  it('returns true when all anchors exist without [[', async () => {
    await mkdir(join(wikiRoot, 'notes'), { recursive: true })
    await writeFile(join(wikiRoot, 'notes/plain.md'), 'Just prose. [link](http://example.com)', 'utf-8')

    await expect(shouldSkipWikiTouchUpCheapCheck(wikiRoot, ['notes/plain.md'])).resolves.toBe(true)
  })
})
