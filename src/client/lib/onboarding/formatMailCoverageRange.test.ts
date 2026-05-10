import { describe, it, expect } from 'vitest'
import { formatMailIndexCoverage, type MailCoverageLabels } from './formatMailCoverageRange.js'

const labels: MailCoverageLabels = {
  present: 'Present',
  since: (d) => `Since ${d}`,
  range: (a, b) => `${a} – ${b}`,
  newestAround: (d) => `Newest ${d}`,
}

describe('formatMailIndexCoverage', () => {
  const fixedToday = new Date(2026, 4, 10) // May 10, 2026 local

  it('returns null when both ends are missing', () => {
    expect(formatMailIndexCoverage(null, null, labels, { today: fixedToday })).toBeNull()
    expect(formatMailIndexCoverage('  ', '', labels, { today: fixedToday })).toBeNull()
  })

  it('formats since when only from is set', () => {
    expect(formatMailIndexCoverage('2022-01-15', null, labels, { locale: 'en-US', today: fixedToday })).toBe(
      'Since Jan 2022',
    )
  })

  it('returns null when only latest is today (cannot infer how far back)', () => {
    expect(formatMailIndexCoverage(null, '2026-05-10', labels, { locale: 'en-US', today: fixedToday })).toBeNull()
  })

  it('formats newest-around when only latest is in the past', () => {
    expect(formatMailIndexCoverage(null, '2025-06-01', labels, { locale: 'en-US', today: fixedToday })).toBe(
      'Newest Jun 2025',
    )
  })

  it('collapses same calendar month to a single label', () => {
    expect(
      formatMailIndexCoverage('2024-03-02', '2024-03-28', labels, { locale: 'en-US', today: fixedToday }),
    ).toBe('Mar 2024')
  })

  it('uses Present when end date is today or later', () => {
    expect(
      formatMailIndexCoverage('2022-01-01', '2026-05-10', labels, { locale: 'en-US', today: fixedToday }),
    ).toBe('Jan 2022 – Present')
  })

  it('uses month-year for a closed historical span', () => {
    expect(
      formatMailIndexCoverage('2022-01-01', '2025-11-30', labels, { locale: 'en-US', today: fixedToday }),
    ).toBe('Jan 2022 – Nov 2025')
  })

  it('parses SQLite datetime strings', () => {
    expect(
      formatMailIndexCoverage('2020-01-01 00:00:00', '2026-05-10 12:00:00', labels, {
        locale: 'en-US',
        today: fixedToday,
      }),
    ).toBe('Jan 2020 – Present')
  })
})
