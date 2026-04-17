import { describe, expect, it } from 'vitest'
import {
  buildIndexingElapsedLine,
  buildIndexingProgressLine,
  formatSyncLockAgeMs,
} from './onboardingIndexingUi.js'
import { emptyOnboardingMail } from './onboardingTypes.js'

describe('formatSyncLockAgeMs', () => {
  it('returns null for null, non-finite, or under 1s', () => {
    expect(formatSyncLockAgeMs(null)).toBeNull()
    expect(formatSyncLockAgeMs(undefined)).toBeNull()
    expect(formatSyncLockAgeMs(NaN)).toBeNull()
    expect(formatSyncLockAgeMs(500)).toBeNull()
  })

  it('formats seconds only under 1 minute', () => {
    expect(formatSyncLockAgeMs(1500)).toBe('1s')
    expect(formatSyncLockAgeMs(59_000)).toBe('59s')
  })

  it('formats minutes and seconds', () => {
    expect(formatSyncLockAgeMs(90_000)).toBe('1m 30s')
  })
})

describe('buildIndexingProgressLine', () => {
  it('returns null when no progress to show', () => {
    const m = emptyOnboardingMail()
    expect(buildIndexingProgressLine(m)).toBeNull()
  })

  it('includes indexed count when positive', () => {
    const m = { ...emptyOnboardingMail(), indexedTotal: 42 }
    expect(buildIndexingProgressLine(m)).toBe('42 messages indexed so far')
  })

  it('includes sync running with age when lock age is known', () => {
    const m = {
      ...emptyOnboardingMail(),
      syncRunning: true,
      syncLockAgeMs: 90_000,
    }
    expect(buildIndexingProgressLine(m)).toBe('Sync running (1m 30s)')
  })

  it('joins count and sync with middle dot', () => {
    const m = {
      ...emptyOnboardingMail(),
      indexedTotal: 100,
      syncRunning: true,
      syncLockAgeMs: 2000,
    }
    expect(buildIndexingProgressLine(m)).toBe('100 messages indexed so far · Sync running (2s)')
  })
})

describe('buildIndexingElapsedLine', () => {
  const t0 = 1_000_000_000_000

  it('returns null when not indexing or no start time', () => {
    expect(buildIndexingElapsedLine('indexing', null, t0)).toBeNull()
    expect(buildIndexingElapsedLine('not-started', t0, t0 + 120_000)).toBeNull()
  })

  it('returns null under 2 minutes elapsed', () => {
    expect(buildIndexingElapsedLine('indexing', t0, t0 + 119_000)).toBeNull()
  })

  it('returns short reassurance between 2 and 5 minutes', () => {
    const line = buildIndexingElapsedLine('indexing', t0, t0 + 3 * 60_000)
    expect(line).toContain('Still working')
  })

  it('returns long message at 5+ minutes with minute count', () => {
    const line = buildIndexingElapsedLine('indexing', t0, t0 + 7 * 60_000)
    expect(line).toContain('7 minutes')
  })
})
