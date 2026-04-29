import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sanitizeWikiEvalCaseDirName, wikiEvalCaseBrainWikiParent } from './wikiEvalCasePaths.js'

const here = dirname(fileURLToPath(import.meta.url))
const fakeRoot = join(here, '..', '..', '..')

describe('wikiEvalCasePaths', () => {
  it('sanitizeWikiEvalCaseDirName keeps wiki task ids stable', () => {
    expect(sanitizeWikiEvalCaseDirName('wiki-001-buildout-smoke')).toBe('wiki-001-buildout-smoke')
    expect(sanitizeWikiEvalCaseDirName('wiki-002-cleanup-smoke')).toBe('wiki-002-cleanup-smoke')
  })

  it('sanitizeWikiEvalCaseDirName removes unsafe characters', () => {
    expect(sanitizeWikiEvalCaseDirName('a/../b')).toBe('a_.._b')
    expect(sanitizeWikiEvalCaseDirName('x:y\\z')).toBe('x_y_z')
  })

  it('sanitizeWikiEvalCaseDirName falls back when empty', () => {
    expect(sanitizeWikiEvalCaseDirName('')).toBe('case')
    expect(sanitizeWikiEvalCaseDirName('___')).toBe('case')
  })

  it('wikiEvalCaseBrainWikiParent uses .data-eval/wiki-eval-cases/<id>', () => {
    expect(wikiEvalCaseBrainWikiParent(fakeRoot, 'wiki-001-buildout-smoke')).toBe(
      join(fakeRoot, '.data-eval', 'wiki-eval-cases', 'wiki-001-buildout-smoke'),
    )
  })
})
