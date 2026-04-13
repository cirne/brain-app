import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown.js'

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
})
