import { describe, it, expect } from 'vitest'
import type { CalendarEventDetail } from './calendarEventDetailFormat.js'
import { formatCalendarEventWhen, calendarSourceLabel } from './calendarEventDetailFormat.js'

describe('formatCalendarEventWhen', () => {
  it('formats single all-day', () => {
    const e: CalendarEventDetail = {
      title: 'Trip',
      start: '2026-04-14',
      end: '2026-04-15',
      allDay: true,
      source: 'travel',
    }
    expect(formatCalendarEventWhen(e)).toContain('2026')
    expect(formatCalendarEventWhen(e)).toContain('all day')
  })

  it('formats timed same day', () => {
    const e: CalendarEventDetail = {
      title: 'Meet',
      start: '2026-04-14T21:30:00.000Z',
      end: '2026-04-14T22:30:00.000Z',
      allDay: false,
      source: 'personal',
    }
    const s = formatCalendarEventWhen(e)
    expect(s).toMatch(/–/)
  })
})

describe('calendarSourceLabel', () => {
  it('maps sources', () => {
    expect(calendarSourceLabel('travel')).toBe('Travel')
    expect(calendarSourceLabel('personal')).toBe('Personal')
  })
})
