import { describe, it, expect } from 'vitest'
import {
  stripHtmlNotesToPlain,
  extractHttpUrls,
  whoQueryFromTitle,
  extractMeetingIds,
} from './calendarNotes.js'

describe('stripHtmlNotesToPlain', () => {
  it('converts br and strips tags', () => {
    const s = stripHtmlNotesToPlain('Hello<br><br><a href="https://x.com">link</a>')
    expect(s).toContain('Hello')
    expect(s).not.toContain('<')
    expect(s).toContain('link')
  })
})

describe('extractHttpUrls', () => {
  it('finds URLs in HTML', () => {
    const u = extractHttpUrls(
      'see <a href="https://gloo.zoom.us/webinar/register/WN_x">here</a>',
    )
    expect(u.some((x) => x.includes('gloo.zoom.us'))).toBe(true)
  })
})

describe('whoQueryFromTitle', () => {
  it('uses first word', () => {
    expect(whoQueryFromTitle('Gloo Investor Update')).toBe('Gloo')
  })
})

describe('extractMeetingIds', () => {
  it('extracts Zoom meeting ID from URL', () => {
    const ids = extractMeetingIds(
      'Join https://gloo.zoom.us/webinar/register/WN_o3zWgmbaS56xe818Po6mMQ',
    )
    expect(ids).toContain('WN_o3zWgmbaS56xe818Po6mMQ')
  })

  it('extracts Zoom /j/ meeting number', () => {
    const ids = extractMeetingIds('https://us02web.zoom.us/j/81234567890?pwd=abc')
    expect(ids).toContain('81234567890')
  })

  it('extracts Google Meet code', () => {
    const ids = extractMeetingIds('https://meet.google.com/abc-defg-hij')
    expect(ids).toContain('abc-defg-hij')
  })

  it('returns empty for non-conference URLs', () => {
    expect(extractMeetingIds('https://docs.google.com/document/d/1234')).toEqual([])
  })

  it('deduplicates', () => {
    const ids = extractMeetingIds(
      'https://zoom.us/j/12345678 and also https://zoom.us/j/12345678',
    )
    expect(ids).toHaveLength(1)
  })
})
