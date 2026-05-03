import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  normalizeWikiPathSegment,
  normalizeWikiRelPathForNaming,
  resolveWikiPathForCreate,
  formatWikiKebabNormalizedFromNote,
} from './wikiPathNaming.js'

describe('wikiPathNaming', () => {
  it('normalizeWikiPathSegment lowercases, dashes, collapses', () => {
    expect(normalizeWikiPathSegment('My_Topic Here')).toBe('my-topic-here')
    expect(normalizeWikiPathSegment('Foo---Bar')).toBe('foo-bar')
  })

  it('normalizeWikiRelPathForNaming normalizes all segments', () => {
    expect(normalizeWikiRelPathForNaming('ideas/My Big Idea.md')).toBe('ideas/my-big-idea.md')
    expect(normalizeWikiRelPathForNaming('people/lewis-cirne.md')).toBe('people/lewis-cirne.md')
    expect(normalizeWikiRelPathForNaming('note.md')).toBe('note.md')
  })

  it('resolveWikiPathForCreate uses canonical when file missing', () => {
    const wiki = mkdtempSync(join(tmpdir(), 'wiki-naming-'))
    try {
      const r = resolveWikiPathForCreate(wiki, 'My File.md')
      expect(r.path).toBe('my-file.md')
      expect(r.normalizedFrom).toBe('My File.md')
    } finally {
      rmSync(wiki, { recursive: true, force: true })
    }
  })

  it('formatWikiKebabNormalizedFromNote matches write/move tool copy', () => {
    expect(formatWikiKebabNormalizedFromNote('ideas/a-b.md', 'Ideas/A B.md')).toBe(
      '\n\nSaved as `ideas/a-b.md` (normalized from requested `Ideas/A B.md`).',
    )
  })

  it('resolveWikiPathForCreate keeps legacy path when file exists at coerced path', () => {
    const wiki = mkdtempSync(join(tmpdir(), 'wiki-naming-'))
    try {
      const legacy = join(wiki, 'My File.md')
      writeFileSync(legacy, '# x\n', 'utf-8')
      const r = resolveWikiPathForCreate(wiki, 'My File.md')
      expect(r.path).toBe('My File.md')
      expect(r.normalizedFrom).toBeNull()
    } finally {
      rmSync(wiki, { recursive: true, force: true })
    }
  })
})
