import { describe, expect, it } from 'vitest'
import {
  mailboxCoversHubBackfillWindow,
  mailboxEarliestDateUtcMs,
} from '@client/lib/hub/hubRipmailSource.js'

describe('mailboxEarliestDateUtcMs', () => {
  it('parses date-only and sqlite datetime shapes', () => {
    expect(mailboxEarliestDateUtcMs('2024-06-01')).toBe(Date.parse('2024-06-01T00:00:00.000Z'))
    expect(mailboxEarliestDateUtcMs('2024-06-01 12:30:45')).toBe(Date.parse('2024-06-01T12:30:45.000Z'))
  })
})

describe('mailboxCoversHubBackfillWindow', () => {
  const anchor = Date.parse('2026-06-01T12:00:00.000Z')
  const dayMs = 86_400_000

  it('is false without messages', () => {
    expect(mailboxCoversHubBackfillWindow(null, 0, '1y', anchor)).toBe(false)
  })

  it('is false when indexed mail is not old enough for the window', () => {
    const earliest = new Date(Date.UTC(2025, 8, 1)).toISOString()
    expect(mailboxCoversHubBackfillWindow(earliest, 5, '1y', anchor)).toBe(false)
    expect(mailboxCoversHubBackfillWindow(earliest, 5, '90d', anchor)).toBe(true)
  })

  it('is true when oldest mail is on or before the rolling cutoff', () => {
    const cutoffMs = anchor - 365 * dayMs
    const earliest = new Date(cutoffMs - dayMs).toISOString()
    expect(mailboxCoversHubBackfillWindow(earliest, 1, '1y', anchor)).toBe(true)
  })
})
