import { describe, it, expect } from 'vitest'
import {
  renderMarkdown,
  stripFrontMatter,
  takeFirstLines,
  joinYamlFrontMatter,
  splitYamlFrontMatter,
  WIKI_PREVIEW_MAX_LINES,
} from './markdown.js'

describe('renderMarkdown', () => {
  it('converts wiki: link with .md extension to wiki-link button', () => {
    const result = renderMarkdown('[health index](wiki:health/_index.md)')
    expect(result).toContain('<button class="wiki-link" data-wiki="health/_index.md">health index</button>')
  })

  it('converts wiki: link without .md extension to wiki-link button, appending .md', () => {
    const result = renderMarkdown('[Dr. Amy Offutt](wiki:people/amy-offutt)')
    expect(result).toContain('<button class="wiki-link" data-wiki="people/amy-offutt.md">Dr. Amy Offutt</button>')
  })

  it('converts date: link to date-link button', () => {
    const result = renderMarkdown('[see notes](date:2026-04-13)')
    expect(result).toContain('<button class="date-link" data-date="2026-04-13">see notes</button>')
  })

  it('does not convert regular https links', () => {
    const result = renderMarkdown('[example](https://example.com)')
    expect(result).toContain('<a href="https://example.com">example</a>')
    expect(result).not.toContain('wiki-link')
  })

  it('renders plain markdown without modification', () => {
    const result = renderMarkdown('**bold** and _italic_')
    expect(result).toContain('<strong>bold</strong>')
    expect(result).toContain('<em>italic</em>')
  })

  it('strips front matter before rendering', () => {
    const raw = `---
type: user-profile
updated: 2026-04-15
---
# Lewis Cirne

Name`
    const result = renderMarkdown(raw)
    expect(result).not.toContain('type: user-profile')
    expect(result).toContain('<h1>Lewis Cirne</h1>')
    expect(result).toContain('<p>Name</p>')
  })
})

describe('stripFrontMatter', () => {
  it('removes yaml block between --- delimiters', () => {
    const raw = `---
updated: 2026-04-13
tags: [people, family]
---
# Katelyn Cirne

Body here.`
    expect(stripFrontMatter(raw)).toBe('# Katelyn Cirne\n\nBody here.')
  })

  it('returns original text when no closing ---', () => {
    const raw = `---
still open
# Not front matter`
    expect(stripFrontMatter(raw)).toBe(raw)
  })

  it('returns original when file does not start with ---', () => {
    expect(stripFrontMatter('# Title\n---')).toBe('# Title\n---')
  })
})

describe('takeFirstLines', () => {
  it('keeps only first N lines', () => {
    expect(takeFirstLines('a\nb\nc\nd', 2)).toBe('a\nb')
  })

  it('WIKI_PREVIEW_MAX_LINES is positive', () => {
    expect(WIKI_PREVIEW_MAX_LINES).toBeGreaterThan(0)
  })
})

describe('splitYamlFrontMatter / joinYamlFrontMatter', () => {
  it('splits leading YAML from body', () => {
    const raw = `---
type: user-profile
---
# Title

Hello`
    const { frontMatter, body } = splitYamlFrontMatter(raw)
    expect(frontMatter).toBe('---\ntype: user-profile\n---')
    expect(body).toBe('# Title\n\nHello')
  })

  it('returns null front matter when file does not start with ---', () => {
    const { frontMatter, body } = splitYamlFrontMatter('# Only\n\nbody')
    expect(frontMatter).toBeNull()
    expect(body).toBe('# Only\n\nbody')
  })

  it('joins front matter and body with trailing newline', () => {
    const out = joinYamlFrontMatter('---\nx: 1\n---', '# H\n\nok')
    expect(out).toBe('---\nx: 1\n---\n\n# H\n\nok\n')
  })
})
