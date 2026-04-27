import { describe, it, expect } from 'vitest'
import { enrichCalendarEventsForAgent, weekdayLongForUtcYmd, type CalendarEvent } from './calendarCache.js'

describe('weekdayLongForUtcYmd', () => {
  it('returns English long weekday for UTC calendar date', () => {
    expect(weekdayLongForUtcYmd('2026-04-20')).toBe('Monday')
    expect(weekdayLongForUtcYmd('2026-04-14')).toBe('Tuesday')
  })

  it('returns empty string for invalid input', () => {
    expect(weekdayLongForUtcYmd('not-a-date')).toBe('')
  })
})

describe('enrichCalendarEventsForAgent', () => {
  it('adds start and end weekdays; all-day end is exclusive so endDayOfWeek is last inclusive day', () => {
    const singleDay: CalendarEvent = {
      id: 'a',
      title: 'A',
      start: '2026-04-20',
      end: '2026-04-21',
      allDay: true,
      source: 'personal',
    }
    const [one] = enrichCalendarEventsForAgent([singleDay])
    expect(one.startDayOfWeek).toBe('Monday')
    expect(one.endDayOfWeek).toBe('Monday')

    const multi: CalendarEvent = {
      id: 'b',
      title: 'Trip',
      start: '2026-04-20',
      end: '2026-05-14',
      allDay: true,
      source: 'travel',
    }
    const [two] = enrichCalendarEventsForAgent([multi])
    expect(two.startDayOfWeek).toBe('Monday')
    expect(two.endDayOfWeek).toBe('Wednesday')
    expect(weekdayLongForUtcYmd('2026-05-13')).toBe('Wednesday')
  })

  it('uses end date for timed events (not exclusive)', () => {
    const timed: CalendarEvent = {
      id: 'c',
      title: 'Zoom',
      start: '2026-04-20T15:00:00Z',
      end: '2026-04-20T16:00:00Z',
      allDay: false,
      source: 'personal',
    }
    const [t] = enrichCalendarEventsForAgent([timed])
    expect(t.startDayOfWeek).toBe('Monday')
    expect(t.endDayOfWeek).toBe('Monday')
  })

  it('uses session timeZone for timed events so weekday is civil not UTC (BUG-021)', () => {
    const timed: CalendarEvent = {
      id: 'd',
      title: 'Late',
      start: '2026-04-21T01:00:00Z',
      end: '2026-04-21T02:00:00Z',
      allDay: false,
      source: 'personal',
    }
    const [utcRow] = enrichCalendarEventsForAgent([timed], { timeZone: 'UTC' })
    expect(utcRow.startDayOfWeek).toBe('Tuesday')

    const [nyRow] = enrichCalendarEventsForAgent([timed], { timeZone: 'America/New_York' })
    expect(nyRow.startDayOfWeek).toBe('Monday')
    expect(nyRow.endDayOfWeek).toBe('Monday')
  })
})
