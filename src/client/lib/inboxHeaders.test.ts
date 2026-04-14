import { describe, it, expect } from 'vitest'
import { parseRawEmailHeaders, emailHeadersForDisplay } from './inboxHeaders.js'

describe('parseRawEmailHeaders', () => {
  it('parses simple headers', () => {
    const m = parseRawEmailHeaders('From: a@b.com\nSubject: Hi\n')
    expect(m.get('from')).toBe('a@b.com')
    expect(m.get('subject')).toBe('Hi')
  })

  it('joins folded continuation lines', () => {
    const raw = 'To: one@x.com,\n  two@y.com\nFrom: me@z.com\n'
    const m = parseRawEmailHeaders(raw)
    expect(m.get('to')).toContain('one@x.com')
    expect(m.get('to')).toContain('two@y.com')
  })
})

describe('emailHeadersForDisplay', () => {
  it('drops references and message-id', () => {
    const raw =
      'From: A <a@b.com>\nReferences: <ref@x.com>\nMessage-ID: <mid@y.com>\nSubject: S\n'
    const rows = emailHeadersForDisplay(raw)
    const keys = rows.map(r => r.key)
    expect(keys).not.toContain('references')
    expect(keys).not.toContain('message-id')
    expect(keys).toContain('from')
    expect(keys).toContain('subject')
  })

  it('orders from, to, date, subject before extras', () => {
    const raw = 'X-Custom: x\nSubject: Subj\nFrom: f@test.com\n'
    const rows = emailHeadersForDisplay(raw)
    const fromIdx = rows.findIndex(r => r.key === 'from')
    const subjIdx = rows.findIndex(r => r.key === 'subject')
    expect(fromIdx).toBeLessThan(subjIdx)
  })
})
