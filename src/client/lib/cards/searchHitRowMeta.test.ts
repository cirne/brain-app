import { describe, expect, it, vi } from 'vitest'
import type { MailSearchHitPreview } from './contentCardShared.js'
import {
  formatSearchHitDateLine,
  searchHitPrimarySubtitle,
  searchHitSnippetLine,
} from './searchHitRowMeta.js'

function hit(x: Partial<MailSearchHitPreview> & Pick<MailSearchHitPreview, 'id'>): MailSearchHitPreview {
  return {
    subject: '',
    from: '',
    snippet: '',
    ...x,
  }
}

describe('searchHitRowMeta', () => {
  it('formatSearchHitDateLine parses ISO dates', () => {
    const s = formatSearchHitDateLine('2026-05-01T12:00:00.000Z')
    expect(s).toBeTruthy()
    expect(s).toContain('2026')
  })

  it('mail row shows from and optional date', () => {
    expect(
      searchHitPrimarySubtitle(
        hit({
          id: 'm',
          subject: 'S',
          from: 'a@b.com',
          snippet: '',
          date: '2026-01-15T00:00:00.000Z',
        }),
        { isIndexed: false },
      ),
    ).toContain('a@b.com')
    expect(
      searchHitPrimarySubtitle(
        hit({ id: 'm', subject: 'S', from: 'a@b.com', snippet: '' }),
        { isIndexed: false },
      ),
    ).toBe('a@b.com')
  })

  it('indexed googleDrive shows label and date', () => {
    const line = searchHitPrimarySubtitle(
      hit({
        id: 'f',
        subject: 'doc.pdf',
        from: '',
        snippet: 'x',
        sourceKind: 'googleDrive',
        date: '2026-03-10T00:00:00.000Z',
      }),
      { isIndexed: true },
    )
    expect(line).toContain('Google Drive')
    expect(line).toContain('2026')
  })

  it('indexed localDir includes truncated path', () => {
    const longPath = `${'Folder/'.repeat(20)}file.pdf`
    const line = searchHitPrimarySubtitle(
      hit({
        id: 'f',
        subject: 'file.pdf',
        from: '',
        snippet: '',
        sourceKind: 'localDir',
        indexedRelPath: longPath,
        date: '2026-01-01T00:00:00.000Z',
      }),
      { isIndexed: true },
    )
    expect(line).toContain('Local files')
    expect(line).toContain('…')
    expect(line.length).toBeLessThan(longPath.length + 80)
  })

  it('slim indexed row shows date only, no fake connector', () => {
    expect(
      searchHitPrimarySubtitle(
        hit({
          id: 'f',
          subject: 'only.pdf',
          from: '',
          snippet: '',
          date: '2026-02-02T00:00:00.000Z',
        }),
        { isIndexed: true },
      ),
    ).toContain('2026')
    expect(
      searchHitPrimarySubtitle(
        hit({
          id: 'f',
          subject: 'only.pdf',
          from: '',
          snippet: '',
          date: '2026-02-02T00:00:00.000Z',
        }),
        { isIndexed: true },
      ),
    ).not.toMatch(/Google Drive|Local files/)
  })

  it('indexed slim without date falls back to Indexed document', () => {
    expect(
      searchHitPrimarySubtitle(
        hit({ id: 'f', subject: 'x.pdf', from: '', snippet: '' }),
        { isIndexed: true },
      ),
    ).toBe('Indexed document')
  })

  it('searchHitSnippetLine prefers snippet then bodyPreview', () => {
    expect(
      searchHitSnippetLine(hit({ id: '1', subject: '', from: '', snippet: ' fts ', bodyPreview: 'body ' })),
    ).toBe('fts')
    expect(
      searchHitSnippetLine(hit({ id: '1', subject: '', from: '', snippet: '', bodyPreview: 'long '.repeat(80) })),
    ).toContain('…')
  })
})

describe('searchHitPrimarySubtitle determinism', () => {
  it('uses default locale for date line', () => {
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('Jan 15, 2026')
    expect(formatSearchHitDateLine('2026-01-15T00:00:00.000Z')).toBe('Jan 15, 2026')
    vi.restoreAllMocks()
  })
})
