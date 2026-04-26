import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_ALLOWED_WIKI_ROOT_MARKDOWN,
  assertAgentWikiWriteUsesSubdirectory,
  isAgentWikiRootMarkdownWriteBlocked,
  isWikiVaultRootMarkdownPath,
  listWikiTopLevelDirectories,
} from './wikiAgentWritePolicy.js'

describe('wikiAgentWritePolicy', () => {
  it('isWikiVaultRootMarkdownPath', () => {
    expect(isWikiVaultRootMarkdownPath('foo.md')).toBe(true)
    expect(isWikiVaultRootMarkdownPath('ideas/foo.md')).toBe(false)
    expect(isWikiVaultRootMarkdownPath('ideas/a/b.md')).toBe(false)
    expect(isWikiVaultRootMarkdownPath('./x.md')).toBe(true)
  })

  it('isAgentWikiRootMarkdownWriteBlocked matches AGENT_ALLOWED_WIKI_ROOT_MARKDOWN only', () => {
    for (const name of AGENT_ALLOWED_WIKI_ROOT_MARKDOWN) {
      expect(isAgentWikiRootMarkdownWriteBlocked(name)).toBe(false)
      expect(isAgentWikiRootMarkdownWriteBlocked(name.toUpperCase())).toBe(false)
    }
    expect(isAgentWikiRootMarkdownWriteBlocked('_index.md')).toBe(true)
    expect(isAgentWikiRootMarkdownWriteBlocked('random.md')).toBe(true)
    expect(isAgentWikiRootMarkdownWriteBlocked('ideas/x.md')).toBe(false)
  })

  describe('listWikiTopLevelDirectories', () => {
    let root: string
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'wiki-policy-'))
      await mkdir(join(root, 'ideas'), { recursive: true })
      await mkdir(join(root, 'people'), { recursive: true })
      await mkdir(join(root, '.obsidian'), { recursive: true })
    })
    afterEach(async () => {
      await rm(root, { recursive: true, force: true })
    })

    it('lists non-hidden directories sorted', async () => {
      const dirs = await listWikiTopLevelDirectories(root)
      expect(dirs).toEqual(['ideas', 'people'])
    })
  })

  describe('assertAgentWikiWriteUsesSubdirectory', () => {
    let root: string
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'wiki-policy-'))
      await mkdir(join(root, 'topics'), { recursive: true })
    })
    afterEach(async () => {
      await rm(root, { recursive: true, force: true })
    })

    it('throws with directory list for disallowed root markdown', async () => {
      await expect(assertAgentWikiWriteUsesSubdirectory(root, 'oops.md')).rejects.toThrow(
        /subdirectory of the wiki/i,
      )
      await expect(assertAgentWikiWriteUsesSubdirectory(root, 'oops.md')).rejects.toThrow(/topics/)
    })

    it('does not throw for allowlisted root files (index.md, me.md)', async () => {
      await expect(assertAgentWikiWriteUsesSubdirectory(root, 'index.md')).resolves.toBeUndefined()
      await expect(assertAgentWikiWriteUsesSubdirectory(root, 'me.md')).resolves.toBeUndefined()
    })

    it('does not throw for nested paths', async () => {
      await expect(assertAgentWikiWriteUsesSubdirectory(root, 'topics/a.md')).resolves.toBeUndefined()
    })
  })
})
