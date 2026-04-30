import { describe, it, expect } from 'vitest'
import { parseCalendarEventRef, ripmailRecurrenceCliFlags } from './calendarTools.js'

describe('parseCalendarEventRef', () => {
  it('parses sourceId:eventUid', () => {
    expect(parseCalendarEventRef('mailbox-gcal:event_abc_20260315T120000Z')).toEqual({
      sourceId: 'mailbox-gcal',
      eventUid: 'event_abc_20260315T120000Z',
    })
  })

  it('throws on malformed id', () => {
    expect(() => parseCalendarEventRef('nocolon')).toThrow(/compound id/)
    expect(() => parseCalendarEventRef(':only')).toThrow(/compound id/)
  })
})

describe('ripmailRecurrenceCliFlags', () => {
  it('maps weekly preset with until', () => {
    expect(
      ripmailRecurrenceCliFlags({
        recurrence: 'weekly',
        recurrence_until: '2026-12-31',
      }),
    ).toBe(' --recurrence-preset "weekly" --recurrence-until "2026-12-31"')
  })

  it('maps raw RRULE', () => {
    const f = ripmailRecurrenceCliFlags({ recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO' })
    expect(f.startsWith(' --rrule ')).toBe(true)
    expect(f).toContain('RRULE')
  })

  it('requires recurrence when count alone', () => {
    expect(() =>
      ripmailRecurrenceCliFlags({
        recurrence_count: 5,
      }),
    ).toThrow(/require recurrence/)
  })
})
