import { describe, expect, it } from 'vitest'
import { formatRipmailSourcesForPrompt } from './ripmailSourcesPromptSection.js'

describe('formatRipmailSourcesForPrompt', () => {
  it('returns empty for empty stdout', () => {
    expect(formatRipmailSourcesForPrompt('')).toBe('')
    expect(formatRipmailSourcesForPrompt('   ')).toBe('')
  })

  it('formats sources with id kind email label', () => {
    const json = JSON.stringify({
      sources: [
        { id: 'acct_gmail_com', kind: 'imap', email: 'me@gmail.com', label: 'Primary' },
        { id: 'acct_gmail_com-drive', kind: 'googleDrive', email: 'me@gmail.com', label: 'NetJets' },
      ],
    })
    const out = formatRipmailSourcesForPrompt(json)
    expect(out).toContain('## Configured ripmail sources (this session)')
    expect(out).toContain('`acct_gmail_com`')
    expect(out).toContain('imap')
    expect(out).toContain('label "Primary"')
    expect(out).toContain('me@gmail.com')
    expect(out).toContain('`acct_gmail_com-drive`')
    expect(out).toContain('googleDrive')
    expect(out).toContain('label "NetJets"')
    expect(out).toContain('are **not** source ids')
  })

  it('returns empty for invalid JSON', () => {
    expect(formatRipmailSourcesForPrompt('not json')).toBe('')
  })

  it('returns empty for empty sources array', () => {
    expect(formatRipmailSourcesForPrompt(JSON.stringify({ sources: [] }))).toBe('')
  })
})
