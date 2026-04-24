import { describe, it, expect } from 'vitest'
import {
  buildFeedbackIssueHeaderHtml,
  renderMarkdown,
  renderMarkdownBody,
  stripFrontMatter,
  takeFirstLines,
  joinYamlFrontMatter,
  splitYamlFrontMatter,
  WIKI_PREVIEW_MAX_LINES,
} from './markdown.js'

describe('renderMarkdown', () => {
  it('converts wiki: link with .md extension to wiki-link anchor', () => {
    const result = renderMarkdown('[health index](wiki:health/_index.md)')
    expect(result).toContain('class="wiki-link"')
    expect(result).toContain('data-wiki="health/_index.md"')
    expect(result).toContain('>health index<')
  })

  it('converts wiki: link without .md extension, appending .md', () => {
    const result = renderMarkdown('[Dr. Amy Offutt](wiki:people/amy-offutt)')
    expect(result).toContain('data-wiki="people/amy-offutt.md"')
    expect(result).toContain('>Dr. Amy Offutt<')
  })

  it('converts Obsidian [[me]] to data-wiki me.md', () => {
    const result = renderMarkdown('See [[me]] for context.')
    expect(result).toContain('data-wiki="me.md"')
  })

  it('renderMarkdownBody applies wikilinks without date-button pass', () => {
    const html = renderMarkdownBody('Link [[people/x]] here.')
    expect(html).toContain('data-wiki="people/x.md"')
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

  it('BUG-001 regression: em dash (U+2014) in markdown renders as the character, not a literal escape', () => {
    const em = '\u2014'
    const result = renderMarkdown(`Title ${em} subtitle`)
    expect(result).toContain(em)
    expect(result).not.toContain('\\u2014')
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
    expect(result).not.toContain('md-fm-meta')
  })

  it('renders feedback issue (bug) front matter as a header, not a raw yaml paragraph', () => {
    const raw = `---
type: bug
title: Resume does not restart agent
appHint: Braintunnel 0.1
---
## Summary

- Something`
    const result = renderMarkdown(raw)
    expect(result).toContain('md-fm-meta')
    expect(result).toContain('md-fm-type--bug')
    expect(result).toContain('>Bug</span>')
    expect(result).toContain('Resume does not restart agent')
    expect(result).toContain('Braintunnel 0.1')
    expect(result).not.toContain('type: bug')
    expect(result).toContain('<h2>Summary</h2>')
  })

  it('renders single-line type/title (no ---) as the same header', () => {
    const raw = `type: bug title: Resume does not restart paused background agent in Braintunnel hub

## Summary

- x`
    const result = renderMarkdown(raw)
    expect(result).toContain('md-fm-meta')
    expect(result).toContain('paused background agent in Braintunnel hub')
  })

  it('escapes HTML in buildFeedbackIssueHeaderHtml title', () => {
    const h = buildFeedbackIssueHeaderHtml({ kind: 'bug', title: '<x>' })
    expect(h).toContain('&lt;x&gt;')
    expect(h).not.toContain('<x>')
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
