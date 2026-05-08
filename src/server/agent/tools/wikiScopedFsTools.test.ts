import { describe, it, expect } from 'vitest'
import {
  toPiCodingAgentFsRelPath,
  stripLegacyMePrefixFromRawPath,
  vaultRelPathFromMeToolPath,
} from './wikiScopedFsTools.js'

describe('wikiScopedFsTools path helpers', () => {
  it('stripLegacyMePrefixFromRawPath removes one redundant me/ prefix', () => {
    expect(stripLegacyMePrefixFromRawPath('me/travel/a.md')).toBe('travel/a.md')
    expect(stripLegacyMePrefixFromRawPath('me')).toBe('.')
  })

  it('stripLegacyMePrefixFromRawPath removes repeated me/me/… (double namespace mistake)', () => {
    expect(stripLegacyMePrefixFromRawPath('me/me/travel/a.md')).toBe('travel/a.md')
    expect(stripLegacyMePrefixFromRawPath('me/me/me/notes.md')).toBe('notes.md')
    expect(stripLegacyMePrefixFromRawPath('./me/me/travel/a.md')).toBe('travel/a.md')
  })

  it('stripLegacyMePrefixFromRawPath leaves non-me paths unchanged (preserves raw)', () => {
    expect(stripLegacyMePrefixFromRawPath('travel/a.md')).toBe('travel/a.md')
    expect(stripLegacyMePrefixFromRawPath('  travel/a.md')).toBe('  travel/a.md')
  })

  it('toPiCodingAgentFsRelPath prefixes @ for pi-coding-agent path resolution', () => {
    expect(toPiCodingAgentFsRelPath('@alice/trips/x.md')).toBe('./@alice/trips/x.md')
    expect(toPiCodingAgentFsRelPath('notes/a.md')).toBe('notes/a.md')
    expect(toPiCodingAgentFsRelPath('.')).toBe('.')
  })

  it('vaultRelPathFromMeToolPath accepts wiki-relative paths and legacy me/…', () => {
    expect(vaultRelPathFromMeToolPath('me/trips/a.md')).toBe('trips/a.md')
    expect(vaultRelPathFromMeToolPath('./me/foo/bar.md')).toBe('foo/bar.md')
    expect(vaultRelPathFromMeToolPath('me')).toBe('')
    expect(vaultRelPathFromMeToolPath('trips/a.md')).toBe('trips/a.md')
    expect(vaultRelPathFromMeToolPath('@alice/x.md')).toBeNull()
  })
})
