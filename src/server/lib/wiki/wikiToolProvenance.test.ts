import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  applyWikiFindProvenanceAnnotations,
  applyWikiGrepProvenanceAnnotations,
  classifyWikiToolsRelPath,
  filePathToToolsRel,
  formatWikiProvenancePrefix,
  grepFilePartToToolsRel,
  normalizeWikiToolsRelPath,
  sharedWikiReadSourceBanner,
} from './wikiToolProvenance.js'

describe('wikiToolProvenance', () => {
  it('classifyWikiToolsRelPath distinguishes vault vs legacy @ paths', () => {
    expect(classifyWikiToolsRelPath('me/travel/a.md')).toEqual({ scope: 'vault', handle: null })
    expect(classifyWikiToolsRelPath('travel/a.md')).toEqual({ scope: 'vault', handle: null })
    expect(classifyWikiToolsRelPath('./me/ideas/x.md')).toEqual({ scope: 'vault', handle: null })
    expect(classifyWikiToolsRelPath('people/x.md')).toEqual({ scope: 'vault', handle: null })
    expect(classifyWikiToolsRelPath('@alice/shared/x.md')).toEqual({ scope: 'legacy_at', handle: 'alice' })
    expect(classifyWikiToolsRelPath('./@bob/y.md')).toEqual({ scope: 'legacy_at', handle: 'bob' })
  })

  it('normalizeWikiToolsRelPath strips ./', () => {
    expect(normalizeWikiToolsRelPath('./me/a.md')).toBe('me/a.md')
  })

  it('formatWikiProvenancePrefix', () => {
    expect(formatWikiProvenancePrefix({ scope: 'vault', handle: null })).toBe('[vault]')
    expect(formatWikiProvenancePrefix({ scope: 'legacy_at', handle: 'pat' })).toBe('[legacy:@pat]')
    expect(formatWikiProvenancePrefix({ scope: 'other', handle: null })).toBe('[wiki]')
  })

  it('filePathToToolsRel maps absolute paths under wiki root', () => {
    const root = '/tmp/wikis-root'
    expect(filePathToToolsRel(root, join(root, 'a.md'))).toBe(`a.md`)
    expect(filePathToToolsRel(root, join(root, '@x', 'b.md'))).toBe(`@x/b.md`)
  })

  it('grepFilePartToToolsRel resolves rg paths relative to the grep search directory', () => {
    const tools = '/data/wikis'
    const search = join(tools, 'travel')
    expect(grepFilePartToToolsRel(tools, search, 'plan.md')).toBe('travel/plan.md')
  })

  it('applyWikiFindProvenanceAnnotations strips me/ for vault-only lists', () => {
    const raw = 'me/a.md\nme/b.md'
    expect(applyWikiFindProvenanceAnnotations(raw)).toBe('a.md\nb.md')
  })

  it('applyWikiFindProvenanceAnnotations tags legacy @ paths and prepends mixed summary', () => {
    const raw = 'me/a.md\n@peer/trip.md'
    const out = applyWikiFindProvenanceAnnotations(raw)
    expect(out).toContain('Wiki search:')
    expect(out).toContain('[vault] a.md')
    expect(out).toContain('[legacy:@peer] @peer/trip.md')
  })

  it('applyWikiFindProvenanceAnnotations preserves trailing find notices', () => {
    const raw = 'me/a.md\n@alice/b.md\n\n[1000 results limit reached]'
    const out = applyWikiFindProvenanceAnnotations(raw)
    expect(out).toContain('[1000 results limit reached]')
    expect(out.indexOf('[vault]')).toBeLessThan(out.indexOf('[1000 results'))
  })

  it('applyWikiGrepProvenanceAnnotations rewrites me/ paths to wiki-relative when vault-only', () => {
    const root = '/w'
    const raw = 'me/a.md:1:hello world'
    expect(applyWikiGrepProvenanceAnnotations(root, root, raw)).toBe('a.md:1:hello world')
  })

  it('applyWikiGrepProvenanceAnnotations tags legacy rg lines and mixed summary', () => {
    const root = '/w'
    const raw = 'me/a.md:1:in mine\n@bob/theirs.md:2:secret EVAL_PEER_TOK\n'
    const out = applyWikiGrepProvenanceAnnotations(root, root, raw.trimEnd())
    expect(out).toContain('Wiki search:')
    expect(out).toContain('[vault] a.md:1:in mine')
    expect(out).toContain('[legacy:@bob] @bob/theirs.md:2:secret EVAL_PEER_TOK')
  })

  it('applyWikiGrepProvenanceAnnotations tags legacy hits when rg paths are relative to @handle/ search dir', () => {
    const tools = '/w'
    const search = join(tools, '@carol')
    const raw = 'notes.md:1:EVAL_IN_LEGACY_SUBTREE_ONLY'
    const out = applyWikiGrepProvenanceAnnotations(tools, search, raw)
    expect(out).toContain('[legacy:@carol]')
    expect(out).toContain('notes.md:1:EVAL_IN_LEGACY_SUBTREE_ONLY')
  })

  it('sharedWikiReadSourceBanner is always null (sharing removed)', () => {
    expect(sharedWikiReadSourceBanner('me/x.md')).toBeNull()
    expect(sharedWikiReadSourceBanner('people/x.md')).toBeNull()
    expect(sharedWikiReadSourceBanner('@alice/plan.md')).toBeNull()
  })
})
