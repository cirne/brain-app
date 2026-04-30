import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CHAT_CAPTURE_STUB_MAX_WORDS,
  isThinCandidatePath,
  listThinWikiPageCandidates,
  mergeWikiDeepenPriorityPaths,
  THIN_PAGE_MAX_WORDS,
} from './wikiThinPageCandidates.js'

describe('wikiThinPageCandidates', () => {
  describe('isThinCandidatePath', () => {
    it('accepts typed-folder markdown only', () => {
      expect(isThinCandidatePath('people/jane-doe.md')).toBe(true)
      expect(isThinCandidatePath('projects/foo/bar.md')).toBe(true)
      expect(isThinCandidatePath('topics/x.md')).toBe(true)
    })

    it('rejects template, hub, profile paths', () => {
      expect(isThinCandidatePath('people/template.md')).toBe(false)
      expect(isThinCandidatePath('me.md')).toBe(false)
      expect(isThinCandidatePath('assistant.md')).toBe(false)
      expect(isThinCandidatePath('index.md')).toBe(false)
      expect(isThinCandidatePath('notes/x.md')).toBe(false)
    })
  })

  describe('mergeWikiDeepenPriorityPaths', () => {
    it('orders recent first and dedupes', () => {
      expect(
        mergeWikiDeepenPriorityPaths(['people/a.md', 'topics/x.md'], ['topics/x.md', 'people/b.md'], 10),
      ).toEqual(['people/a.md', 'topics/x.md', 'people/b.md'])
    })

    it('respects cap', () => {
      expect(mergeWikiDeepenPriorityPaths(['a.md', 'b.md'], ['c.md', 'd.md'], 2)).toEqual(['a.md', 'b.md'])
    })
  })

  describe('listThinWikiPageCandidates', () => {
    let wikiRoot: string

    beforeEach(async () => {
      wikiRoot = await mkdtemp(join(tmpdir(), 'thin-wiki-'))
    })

    afterEach(async () => {
      await rm(wikiRoot, { recursive: true, force: true })
    })

    it('flags short pages under people/', async () => {
      await mkdir(join(wikiRoot, 'people'), { recursive: true })
      await writeFile(join(wikiRoot, 'people', 'x.md'), '# X\n\nhi', 'utf8')
      const thin = await listThinWikiPageCandidates(wikiRoot, ['people/x.md'])
      expect(thin).toContain('people/x.md')
    })

    it('does not flag long pages without Chat capture', async () => {
      await mkdir(join(wikiRoot, 'people'), { recursive: true })
      const filler = Array(THIN_PAGE_MAX_WORDS + 10).fill('word').join(' ')
      await writeFile(join(wikiRoot, 'people', 'y.md'), `# Y\n\n${filler}`, 'utf8')
      const thin = await listThinWikiPageCandidates(wikiRoot, ['people/y.md'])
      expect(thin).toHaveLength(0)
    })

    it('flags Chat capture stubs still under stub word cap', async () => {
      await mkdir(join(wikiRoot, 'topics'), { recursive: true })
      const words = Array(CHAT_CAPTURE_STUB_MAX_WORDS - 5).fill('w').join(' ')
      await writeFile(
        join(wikiRoot, 'topics', 'stub.md'),
        `## Chat capture\n\n${words}`,
        'utf8',
      )
      const thin = await listThinWikiPageCandidates(wikiRoot, ['topics/stub.md'])
      expect(thin).toContain('topics/stub.md')
    })
  })
})
