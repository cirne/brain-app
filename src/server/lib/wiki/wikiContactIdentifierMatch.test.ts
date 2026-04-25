import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  contactSectionMatchesChatIdentifier,
  extractContactOrIdentifiersSectionBodies,
  loadWikiContactSectionBodiesByPath,
  wikiPathsMatchingChatInContactSections,
} from './wikiContactIdentifierMatch.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wiki-contact-match-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('extractContactOrIdentifiersSectionBodies', () => {
  it('collects Contact and Identifiers sections only', () => {
    const md = `# Person

Body line with +15550009999 should not match.

## Contact

Phone: (555) 000-1111

## Notes

More +15550009999

### Identifiers

user@example.com
`
    const bodies = extractContactOrIdentifiersSectionBodies(md)
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toContain('555) 000-1111')
    expect(bodies[0]).not.toContain('09999')
    expect(bodies[1]).toContain('user@example.com')
    expect(bodies[1]).not.toContain('09999')
  })
})

describe('contactSectionMatchesChatIdentifier', () => {
  it('matches phone in section text with flexible formatting', () => {
    const body = 'Reach me at 555-000-1111'
    expect(contactSectionMatchesChatIdentifier(body, '+15550001111')).toBe(true)
  })

  it('matches email case-insensitively', () => {
    expect(contactSectionMatchesChatIdentifier('Email: User@Example.com', 'user@example.com')).toBe(true)
  })

  it('does not match opaque chat id in random text', () => {
    expect(contactSectionMatchesChatIdentifier('Some notes', 'chat123opaque')).toBe(false)
  })
})

describe('loadWikiContactSectionBodiesByPath + wikiPathsMatchingChatInContactSections', () => {
  it('returns paths only when Contact section lists the handle', async () => {
    await mkdir(join(dir, 'people'), { recursive: true })
    await writeFile(
      join(dir, 'people', 'alice.md'),
      `## Bio

+15550003333

## Contact

+1 555-000-1111
`,
      'utf8',
    )
    await writeFile(
      join(dir, 'people', 'bob.md'),
      `## Contact

+15550002222
`,
      'utf8',
    )
    const index = await loadWikiContactSectionBodiesByPath(dir)
    const for111 = wikiPathsMatchingChatInContactSections(index, '+15550001111')
    expect(for111).toEqual(['people/alice.md'])
    const for222 = wikiPathsMatchingChatInContactSections(index, '+15550002222')
    expect(for222).toEqual(['people/bob.md'])
    const for333 = wikiPathsMatchingChatInContactSections(index, '+15550003333')
    expect(for333).toEqual([])
  })
})
