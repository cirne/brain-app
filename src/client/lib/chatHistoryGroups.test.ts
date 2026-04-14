import { describe, expect, it } from 'vitest'
import { CHAT_HISTORY_GROUP_ORDER, groupKeyForUpdatedAt } from './chatHistoryGroups.js'

describe('groupKeyForUpdatedAt', () => {
  /** Local time on the given calendar day (month 0–11). */
  const at = (y: number, monthIndex: number, day: number, h = 12, m = 0) =>
    new Date(y, monthIndex, day, h, m, 0)

  it('returns today for same calendar day', () => {
    const now = at(2026, 3, 14)
    expect(groupKeyForUpdatedAt(at(2026, 3, 14, 8, 0).toISOString(), now)).toBe('today')
  })

  it('returns yesterday for previous calendar day', () => {
    const now = at(2026, 3, 14)
    expect(groupKeyForUpdatedAt(at(2026, 3, 13, 23, 0).toISOString(), now)).toBe('yesterday')
  })

  it('returns week for 2–7 days ago', () => {
    const now = at(2026, 3, 14)
    expect(groupKeyForUpdatedAt(at(2026, 3, 12).toISOString(), now)).toBe('week')
    expect(groupKeyForUpdatedAt(at(2026, 3, 7).toISOString(), now)).toBe('week')
  })

  it('returns month for 8–30 days ago', () => {
    const now = at(2026, 3, 14)
    expect(groupKeyForUpdatedAt(at(2026, 3, 6).toISOString(), now)).toBe('month')
    expect(groupKeyForUpdatedAt(at(2026, 3, 4).toISOString(), now)).toBe('month')
  })

  it('returns older beyond 30 days', () => {
    const now = at(2026, 3, 14)
    expect(groupKeyForUpdatedAt(at(2026, 1, 1).toISOString(), now)).toBe('older')
  })
})

describe('CHAT_HISTORY_GROUP_ORDER', () => {
  it('has stable display order', () => {
    expect(CHAT_HISTORY_GROUP_ORDER[0]).toBe('today')
    expect(CHAT_HISTORY_GROUP_ORDER.at(-1)).toBe('older')
  })
})
