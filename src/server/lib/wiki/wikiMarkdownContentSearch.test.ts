import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { searchWikiMarkdownPaths } from './wikiMarkdownContentSearch.js'

describe('searchWikiMarkdownPaths', () => {
  it('returns empty for blank query', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wiki-search-'))
    try {
      await writeFile(join(dir, 'a.md'), 'hello', 'utf-8')
      expect(await searchWikiMarkdownPaths(dir, '   ')).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('matches case-insensitively and returns sorted relative paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wiki-search-'))
    try {
      await mkdir(join(dir, 'sub'), { recursive: true })
      await writeFile(join(dir, 'z.md'), 'no', 'utf-8')
      await writeFile(join(dir, 'sub', 'b.md'), 'Hello BETA gamma', 'utf-8')
      await writeFile(join(dir, 'a.md'), 'alpha beta', 'utf-8')
      const r = await searchWikiMarkdownPaths(dir, 'beta')
      expect(r).toEqual(['a.md', 'sub/b.md'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats special characters as literal needle (no shell)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wiki-search-'))
    try {
      await writeFile(join(dir, 'x.md'), "foo'; DROP TABLE--\n", 'utf-8')
      await writeFile(join(dir, 'y.md'), 'safe content', 'utf-8')
      const r = await searchWikiMarkdownPaths(dir, "'; DROP TABLE")
      expect(r).toEqual(['x.md'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
