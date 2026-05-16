import { describe, it, expect } from 'vitest'
import {
  mailIndexOldestCoversMinDaysBeforeNow,
  mailIndexMeetsWikiSupervisorHistoryMinimum,
  parseRipmailStatusDateToUtcMs,
  wikiSupervisorMailPreflightPasses,
} from './wikiMailIndexedHistoryGate.js'
describe('wikiMailIndexedHistoryGate', () => {
  it('parses space-separated sqlite-style dates', () => {
    const ms = parseRipmailStatusDateToUtcMs('2024-06-01 12:00:00')
    expect(ms).toBe(Date.parse('2024-06-01T12:00:00Z'))
  })

  it('returns false when from is null', () => {
    expect(mailIndexOldestCoversMinDaysBeforeNow({ from: null, to: '2026-01-01' }, 90, Date.UTC(2026, 4, 16))).toBe(
      false,
    )
  })

  it('returns true when oldest message is old enough vs now', () => {
    const now = Date.UTC(2026, 4, 16, 12, 0, 0)
    const from = new Date(now - 95 * 86_400_000).toISOString()
    expect(mailIndexOldestCoversMinDaysBeforeNow({ from, to: new Date(now).toISOString() }, 90, now)).toBe(true)
  })

  it('returns false when corpus is only 30 days deep', () => {
    const now = Date.UTC(2026, 4, 16, 12, 0, 0)
    const from = new Date(now - 30 * 86_400_000).toISOString()
    expect(mailIndexMeetsWikiSupervisorHistoryMinimum({ from, to: new Date(now).toISOString() }, now)).toBe(false)
  })

  it('wikiSupervisorMailPreflightPasses requires count and history', () => {
    const now = Date.UTC(2026, 4, 16, 12, 0, 0)
    const oldFrom = new Date(now - 120 * 86_400_000).toISOString()
    expect(
      wikiSupervisorMailPreflightPasses(
        {
          configured: true,
          indexedTotal: 1000,
          ftsReady: 1000,
          dateRange: { from: oldFrom, to: new Date(now).toISOString() },
        },
        now,
      ),
    ).toBe(true)

    const recentFrom = new Date(now - 10 * 86_400_000).toISOString()
    expect(
      wikiSupervisorMailPreflightPasses(
        {
          configured: true,
          indexedTotal: 2000,
          ftsReady: 2000,
          dateRange: { from: recentFrom, to: new Date(now).toISOString() },
        },
        now,
      ),
    ).toBe(false)
  })

})
