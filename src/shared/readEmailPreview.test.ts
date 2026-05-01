import { describe, it, expect } from 'vitest'
import {
  buildReadEmailPreviewDetails,
  extractRipmailIndexedMarkdownTitle,
  pickReadEmailFields,
} from './readEmailPreview.js'

describe('readEmailPreview', () => {
  it('extractRipmailIndexedMarkdownTitle reads markdown ## line', () => {
    expect(extractRipmailIndexedMarkdownTitle('## Report.pdf\n\nHello')).toBe('Report.pdf')
  })

  it('extractRipmailIndexedMarkdownTitle reads flattened excerpt', () => {
    expect(extractRipmailIndexedMarkdownTitle('## Contract.pdf Docu sign envelope')).toBe('Contract.pdf')
  })

  it('pickReadEmailFields uses first thread message when top-level fields missing', () => {
    const j = {
      messages: [
        {
          subject: 'Re: Hello',
          from: { name: 'Dan', address: 'dan@x.com' },
          body: 'Thread body here.',
        },
      ],
    }
    const p = pickReadEmailFields(j as Record<string, unknown>)
    expect(p.subject).toBe('Re: Hello')
    expect(p.from).toContain('Dan')
    expect(p.body).toContain('Thread body')
  })

  it('buildReadEmailPreviewDetails produces snippet and id', () => {
    const d = buildReadEmailPreviewDetails(
      {
        subject: 'S',
        from: 'a@b.com',
        body: 'Hello world '.repeat(40),
      },
      'msg-99',
    )
    expect(d.readEmailPreview).toBe(true)
    expect(d.id).toBe('msg-99')
    expect(d.subject).toBe('S')
    expect(d.snippet.length).toBeLessThanOrEqual(201)
    expect(d.snippet.endsWith('…')).toBe(true)
  })
})
