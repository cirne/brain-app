import { describe, it, expect } from 'vitest'
import { createWikiUnifiedDiff, safeWikiRelativePath } from './wikiEditDiff.js'

describe('wikiEditDiff', () => {
  it('safeWikiRelativePath rejects traversal', () => {
    expect(safeWikiRelativePath('/wiki', '../etc/passwd')).toBeNull()
    expect(safeWikiRelativePath('/wiki', 'foo/../../../etc')).toBeNull()
  })

  it('safeWikiRelativePath returns normalized relative path', () => {
    expect(safeWikiRelativePath('/wiki', 'ideas/foo.md')).toBe('ideas/foo.md')
  })

  it('createWikiUnifiedDiff includes line changes', () => {
    const u = createWikiUnifiedDiff('index.md', 'hello\n', 'hello\nworld\n')
    expect(u).toContain('@@')
    expect(u).toContain('+world')
  })
})
