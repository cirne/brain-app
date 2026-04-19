import { describe, it, expect } from 'vitest'
import { mapRipmailRowToCalendarEvent, type RipmailCalendarEventJson } from './calendarRipmail.js'

describe('mapRipmailRowToCalendarEvent', () => {
  it('maps a timed event', () => {
    const row: RipmailCalendarEventJson = {
      uid: 'evt-1',
      sourceId: 'u_gmail_com-gcal',
      sourceKind: 'googleCalendar',
      summary: 'Stand-up',
      startAt: 1712919600, // 2024-04-12T11:00:00Z
      endAt: 1712921400,   // 2024-04-12T11:30:00Z
      allDay: false,
      location: 'Zoom',
      description: 'Daily sync',
      color: '#039be5',
    }
    const ev = mapRipmailRowToCalendarEvent(row)!
    expect(ev.id).toBe('u_gmail_com-gcal:evt-1')
    expect(ev.title).toBe('Stand-up')
    expect(ev.source).toBe('googleCalendar')
    expect(ev.allDay).toBe(false)
    expect(ev.start).toBe('2024-04-12T11:00:00Z')
    expect(ev.end).toBe('2024-04-12T11:30:00Z')
    expect(ev.location).toBe('Zoom')
    expect(ev.description).toBe('Daily sync')
    expect(ev.color).toBe('#039be5')
  })

  it('maps all-day with exclusive end date', () => {
    const row: RipmailCalendarEventJson = {
      uid: 'ev2',
      sourceId: 's1',
      sourceKind: 'icsSubscription',
      summary: 'Trip',
      startAt: Date.UTC(2026, 3, 12) / 1000,
      endAt: Date.UTC(2026, 3, 15) / 1000,
      allDay: true,
    }
    const ev = mapRipmailRowToCalendarEvent(row)!
    expect(ev.allDay).toBe(true)
    expect(ev.start).toBe('2026-04-12')
    expect(ev.end).toBe('2026-04-15')
  })

  it('parses attendees from JSON string', () => {
    const row: RipmailCalendarEventJson = {
      uid: 'ev3',
      sourceId: 's1',
      startAt: 1000,
      endAt: 2000,
      attendeesJson: JSON.stringify([
        'a@example.com',
        { email: 'B@Example.Com' }
      ]),
      organizerEmail: 'ORG@example.com'
    }
    const ev = mapRipmailRowToCalendarEvent(row)!
    expect(ev.attendees).toEqual(['a@example.com', 'b@example.com'])
    expect(ev.organizer).toBe('org@example.com')
  })

  it('returns null for missing required fields', () => {
    expect(mapRipmailRowToCalendarEvent({ uid: 'x' })).toBeNull()
    expect(mapRipmailRowToCalendarEvent({ startAt: 1, endAt: 2 })).toBeNull()
  })
})
