import { describe, it, expect } from 'vitest'
import { civilYmdInTimeZone, localYmdFromDate } from './calendarLocalYmd.js'

describe('civilYmdInTimeZone (BUG-021)', () => {
  it('uses civil date in America/New_York, not UTC prefix', () => {
    const iso = '2026-04-21T01:00:00.000Z'
    expect(iso.slice(0, 10)).toBe('2026-04-21')
    expect(civilYmdInTimeZone(iso, 'America/New_York')).toBe('2026-04-20')
  })

  it('uses civil date in Asia/Tokyo when UTC date is still previous day', () => {
    const iso = '2026-04-05T15:00:00.000Z'
    expect(iso.slice(0, 10)).toBe('2026-04-05')
    expect(civilYmdInTimeZone(iso, 'Asia/Tokyo')).toBe('2026-04-06')
  })

  it('returns empty for invalid ISO', () => {
    expect(civilYmdInTimeZone('not-a-date', 'UTC')).toBe('')
  })
})

describe('localYmdFromDate (BUG-021)', () => {
  it('uses local getFullYear/Month/Date, not toISOString UTC day (e.g. same calendar day in Tokyo)', () => {
    const d = new Date(2026, 3, 6, 0, 0, 0, 0)
    const localYmd = localYmdFromDate(d)
    expect(localYmd).toBe('2026-04-06')
    const fromUtcPrefix = d.toISOString().slice(0, 10)
    if (fromUtcPrefix !== '2026-04-06') {
      expect(localYmd).not.toBe(fromUtcPrefix)
    }
  })
})
