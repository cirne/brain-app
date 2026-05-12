import { describe, expect, it } from 'vitest'
import {
  buildGmailRawMessage,
  buildReplyReferenceHeaders,
  normalizeMessageIdForHeader,
} from './send.js'

describe('ripmail send reply headers', () => {
  it('normalizes bare message ids for headers', () => {
    expect(normalizeMessageIdForHeader('abc123@example.com')).toBe('<abc123@example.com>')
    expect(normalizeMessageIdForHeader(' <abc123@example.com> ')).toBe('<abc123@example.com>')
  })

  it('builds In-Reply-To and References for reply drafts', () => {
    expect(buildReplyReferenceHeaders({ inReplyToMessageId: 'msg-1@example.com' })).toEqual({
      inReplyTo: '<msg-1@example.com>',
      references: ['<msg-1@example.com>'],
    })
  })

  it('omits reply headers when draft is not a reply', () => {
    expect(buildReplyReferenceHeaders({})).toEqual({})
  })

  it('includes reply headers in gmail raw payload', () => {
    const raw = buildGmailRawMessage({
      from: 'sender@example.com',
      to: 'alice@example.com',
      subject: 'Re: hello',
      body: 'Thanks!',
      inReplyToMessageId: 'msg-2@example.com',
    })

    expect(raw).toContain('In-Reply-To: <msg-2@example.com>')
    expect(raw).toContain('References: <msg-2@example.com>')
  })
})
