import { describe, it, expect } from 'vitest'
import {
  enrichCalendarEventsForAgent,
  weekdayLongForUtcYmd,
  windowDaysFromYmd,
  selectResolutionTier,
  applyResolutionFilter,
  type CalendarEvent,
} from './calendarCache.js'

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

  it('passes recurring through to agent row when set', () => {
    const ev: CalendarEvent = {
      id: 'r1',
      title: 'Weekly',
      start: '2026-04-20T15:00:00Z',
      end: '2026-04-20T16:00:00Z',
      allDay: false,
      source: 'googleCalendar',
      recurring: true,
    }
    const [row] = enrichCalendarEventsForAgent([ev])
    expect(row.recurring).toBe(true)
  })
})

describe('windowDaysFromYmd', () => {
  it('returns inclusive day count', () => {
    expect(windowDaysFromYmd('2026-04-01', '2026-04-01')).toBe(1)
    expect(windowDaysFromYmd('2026-04-01', '2026-04-30')).toBe(30)
    expect(windowDaysFromYmd('2026-04-01', '2026-05-05')).toBe(35)
  })
})

describe('selectResolutionTier', () => {
  it('maps window length only (no overrides)', () => {
    expect(selectResolutionTier(9)).toBe('full')
    expect(selectResolutionTier(10)).toBe('overview')
    expect(selectResolutionTier(30)).toBe('overview')
    expect(selectResolutionTier(31)).toBe('landmarks')
    expect(selectResolutionTier(100)).toBe('landmarks')
  })
})

describe('applyResolutionFilter', () => {
  const mk = (p: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'start' | 'end' | 'allDay' | 'source'>): CalendarEvent => ({
    id: p.id,
    title: p.title,
    start: p.start,
    end: p.end,
    allDay: p.allDay,
    source: p.source,
    recurring: p.recurring,
    description: p.description,
    location: p.location,
  })

  it('full tier keeps all', () => {
    const events = [
      mk({ id: '1', title: 'A', start: '2026-04-01T10:00:00Z', end: '2026-04-01T10:30:00Z', allDay: false, source: 'x', recurring: true }),
    ]
    const { filtered, recurringSuppressedCount } = applyResolutionFilter(events, 'full')
    expect(filtered).toHaveLength(1)
    expect(recurringSuppressedCount).toBe(0)
  })

  it('landmarks drops recurring and short timed', () => {
    const events = [
      mk({ id: 'r', title: 'R', start: '2026-04-01T10:00:00Z', end: '2026-04-01T10:30:00Z', allDay: false, source: 'x', recurring: true }),
      mk({ id: 's', title: 'S', start: '2026-04-01T10:00:00Z', end: '2026-04-01T10:30:00Z', allDay: false, source: 'x' }),
      mk({ id: 'l', title: 'L', start: '2026-04-01T09:00:00Z', end: '2026-04-01T15:00:00Z', allDay: false, source: 'x' }),
      mk({ id: 'd', title: 'D', start: '2026-04-02', end: '2026-04-03', allDay: true, source: 'x' }),
    ]
    const { filtered, recurringSuppressedCount } = applyResolutionFilter(events, 'landmarks')
    expect(recurringSuppressedCount).toBe(1)
    expect(filtered.map(e => e.id).sort()).toEqual(['d', 'l'])
  })

  it('overview drops recurring only', () => {
    const events = [
      mk({ id: 'r', title: 'R', start: '2026-04-01T10:00:00Z', end: '2026-04-01T10:30:00Z', allDay: false, source: 'x', recurring: true }),
      mk({ id: 's', title: 'S', start: '2026-04-01T10:00:00Z', end: '2026-04-01T10:30:00Z', allDay: false, source: 'x' }),
    ]
    const { filtered, recurringSuppressedCount } = applyResolutionFilter(events, 'overview')
    expect(recurringSuppressedCount).toBe(1)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('s')
  })
})

describe('enrichCalendarEventsForAgent overview tier', () => {
  it('strips description and location for timed only', () => {
    const timed: CalendarEvent = {
      id: 't',
      title: 'T',
      start: '2026-04-20T15:00:00Z',
      end: '2026-04-20T16:00:00Z',
      allDay: false,
      source: 'googleCalendar',
      description: 'Body',
      location: 'Here',
    }
    const allday: CalendarEvent = {
      id: 'a',
      title: 'A',
      start: '2026-04-20',
      end: '2026-04-21',
      allDay: true,
      source: 'googleCalendar',
      description: 'AllDesc',
      location: 'There',
    }
    const [tRow, aRow] = enrichCalendarEventsForAgent([timed, allday], { tier: 'overview' })
    expect(tRow.description).toBeUndefined()
    expect(tRow.location).toBeUndefined()
    expect(aRow.description).toContain('AllDesc')
    expect(aRow.location).toBe('There')
  })
})
