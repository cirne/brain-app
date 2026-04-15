import { describe, expect, it } from 'vitest'
import { countSeedEligibleWikiPages } from './seedWikiPageCount.js'

describe('countSeedEligibleWikiPages', () => {
  it('excludes root me.md', () => {
    expect(countSeedEligibleWikiPages(['me.md', 'people/x.md'])).toBe(1)
  })

  it('counts multiple non-profile pages', () => {
    expect(
      countSeedEligibleWikiPages(['me.md', 'people/a.md', 'projects/b.md', 'ideas/c.md']),
    ).toBe(3)
  })

  it('returns 0 when only me.md', () => {
    expect(countSeedEligibleWikiPages(['me.md'])).toBe(0)
  })

  it('ignores path separators variants for me.md', () => {
    expect(countSeedEligibleWikiPages(['me.md', './me.md'])).toBe(0)
  })
})
