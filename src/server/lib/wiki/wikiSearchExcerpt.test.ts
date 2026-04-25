import { describe, it, expect } from 'vitest'
import { buildWikiExcerpt, stripYamlFrontMatter, toSearchPlainText } from './wikiSearchExcerpt.js'

describe('wikiSearchExcerpt', () => {
  it('stripYamlFrontMatter removes leading front matter', () => {
    const raw = '---\ntitle: X\n---\n# Hi\nBody.'
    expect(stripYamlFrontMatter(raw)).toBe('# Hi\nBody.')
  })

  it('toSearchPlainText strips headings and flattens whitespace', () => {
    const raw = '# Title\n\nHello *world* and [link](http://x).'
    expect(toSearchPlainText(raw)).toBe('Hello world and link.')
  })

  it('buildWikiExcerpt centers on query match', () => {
    const raw = '# P\n' + 'word '.repeat(40) + 'needle here ' + 'x '.repeat(40)
    const ex = buildWikiExcerpt(raw, 'needle')
    expect(ex.toLowerCase()).toContain('needle')
    expect(ex.startsWith('…') || ex.includes('needle')).toBe(true)
  })

  it('buildWikiExcerpt uses first token when phrase not in body', () => {
    const raw = '# Doc\nSomething about **zephyr** flights.'
    const ex = buildWikiExcerpt(raw, 'zephyr flights')
    expect(ex.toLowerCase()).toContain('zephyr')
  })

  it('buildWikiExcerpt falls back to start when no match', () => {
    const raw = '# A\nKnown content.'
    const ex = buildWikiExcerpt(raw, 'zzznope')
    expect(ex).toMatch(/known content/i)
  })
})
