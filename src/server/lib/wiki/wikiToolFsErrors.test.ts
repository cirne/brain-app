import { describe, it, expect } from 'vitest'
import { sanitizeWikiFilesystemToolError } from './wikiToolFsErrors.js'

describe('sanitizeWikiFilesystemToolError', () => {
  it('maps ENOENT without leaking absolute paths', () => {
    const raw = Object.assign(new Error("ENOENT: no such file or directory, open '/Users/x/brain/wikis/me/a.md'"), {
      code: 'ENOENT' as const,
    })
    const e = sanitizeWikiFilesystemToolError('me/a.md', raw)
    expect(e.message).toContain('(wiki path: me/a.md)')
    expect(e.message).not.toContain('/Users/')
    expect((e as Error & { code?: string }).code).toBe('ENOENT')
  })

  it('uses generic fallback for unknown errors without forwarding raw message', () => {
    const e = sanitizeWikiFilesystemToolError('me/x.md', new Error('something weird'))
    expect(e.message).toBe('Wiki file operation failed (wiki path: me/x.md)')
  })
})
