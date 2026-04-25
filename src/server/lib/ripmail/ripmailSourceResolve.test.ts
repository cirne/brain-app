import { describe, expect, it } from 'vitest'
import { normalizeRipmailSourceSpecifier } from './ripmailSourceResolve.js'

describe('normalizeRipmailSourceSpecifier', () => {
  it('returns exact id match', () => {
    const out = normalizeRipmailSourceSpecifier('applemail_local', [
      { id: 'applemail_local', kind: 'applemail', email: 'applemail@local' },
    ])
    expect(out).toBe('applemail_local')
  })

  it('maps configured email to id', () => {
    const out = normalizeRipmailSourceSpecifier('User@Example.com', [
      { id: 'u1', kind: 'imap', email: 'user@example.com' },
    ])
    expect(out).toBe('u1')
  })

  it('maps imap alias to id', () => {
    const out = normalizeRipmailSourceSpecifier('alias@x.com', [
      { id: 'm1', kind: 'imap', email: 'a@b.com', imap: { aliases: ['Alias@x.com'] } },
    ])
    expect(out).toBe('m1')
  })

  it('single applemail source: inferred email maps to sole source id', () => {
    const out = normalizeRipmailSourceSpecifier('lewiscirne@mac.com', [
      { id: 'applemail_local', kind: 'applemail', email: 'applemail@local' },
    ])
    expect(out).toBe('applemail_local')
  })

  it('does not remap arbitrary email when multiple mail sources exist', () => {
    const out = normalizeRipmailSourceSpecifier('unknown@z.com', [
      { id: 'a', kind: 'imap', email: 'a@x.com' },
      { id: 'b', kind: 'imap', email: 'b@y.com' },
    ])
    expect(out).toBe('unknown@z.com')
  })

  it('ignores localDir-only config for single-source fallback', () => {
    const out = normalizeRipmailSourceSpecifier('docs@local', [
      { id: 'notes', kind: 'localDir', email: '' },
    ])
    expect(out).toBe('docs@local')
  })
})
