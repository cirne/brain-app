import { describe, it, expect, vi } from 'vitest'
import {
  getCalendarEventsFromRipmail,
  mapRipmailRowToCalendarEvent,
  eventIsRecurringFromRipmailRow,
  calendarUidLooksLikeExpandedRecurrence,
  calendarEventsFromRipmailRangeJsonStdout,
  flattenRipmailListCalendarsJson,
  type RipmailCalendarEventJson,
} from './calendarRipmail.js'
import * as ripmailRun from '@server/lib/ripmail/ripmailRun.js'

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

  it('sets recurring when uid looks like an expanded instance (#occ) without recurrenceJson (Apple / Google)', () => {
    const row: RipmailCalendarEventJson = {
      uid: '7tdrcpd2mjp34lstf5cq3hr4j7@google.com#occ33886',
      sourceId: 'apple-cal',
      sourceKind: 'appleCalendar',
      summary: 'Kirsten Girls Trip',
      startAt: 1745971200,
      endAt: 1746057600,
      allDay: true,
    }
    const ev = mapRipmailRowToCalendarEvent(row)!
    expect(ev.recurring).toBe(true)
  })

  it('sets recurring when uid contains Google /RID=', () => {
    const row: RipmailCalendarEventJson = {
      uid: '6npv9mikb1fv3ikd3p528s7r1k@google.com/RID=799336800#occ61802',
      sourceId: 'apple-cal',
      sourceKind: 'appleCalendar',
      summary: 'Susan',
      startAt: 1712919600,
      endAt: 1712948400,
      allDay: false,
    }
    const ev = mapRipmailRowToCalendarEvent(row)!
    expect(ev.recurring).toBe(true)
  })

  it('returns null for missing required fields', () => {
    expect(mapRipmailRowToCalendarEvent({ uid: 'x' })).toBeNull()
    expect(mapRipmailRowToCalendarEvent({ startAt: 1, endAt: 2 })).toBeNull()
  })

  it('sets recurring when recurrenceJson is a non-empty array (Google expanded instance)', () => {
    const row: RipmailCalendarEventJson = {
      uid: 'inst-1',
      sourceId: 'gcal',
      sourceKind: 'googleCalendar',
      startAt: 1712919600,
      endAt: 1712921400,
      recurrenceJson: JSON.stringify(['RRULE:FREQ=WEEKLY;BYDAY=MO']),
    }
    const ev = mapRipmailRowToCalendarEvent(row)!
    expect(ev.recurring).toBe(true)
  })

  it('sets recurring when rrule is non-empty (ICS)', () => {
    const row: RipmailCalendarEventJson = {
      uid: 'ics-1',
      sourceId: 'ics',
      sourceKind: 'icsSubscription',
      startAt: 1712919600,
      endAt: 1712921400,
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
    }
    const ev = mapRipmailRowToCalendarEvent(row)!
    expect(ev.recurring).toBe(true)
  })

  it('does not set recurring for empty recurrence array string', () => {
    const row: RipmailCalendarEventJson = {
      uid: 'x',
      sourceId: 's',
      startAt: 1,
      endAt: 2,
      recurrenceJson: '[]',
    }
    const ev = mapRipmailRowToCalendarEvent(row)!
    expect(ev.recurring).toBeFalsy()
  })
})

describe('eventIsRecurringFromRipmailRow', () => {
  it('returns false for invalid recurrence JSON (falls through to uid)', () => {
    expect(eventIsRecurringFromRipmailRow(null, 'not-json')).toBe(false)
  })

  it('returns true from uid when #occ present', () => {
    expect(eventIsRecurringFromRipmailRow(null, null, 'x@y#occ1')).toBe(true)
  })
})

describe('calendarUidLooksLikeExpandedRecurrence', () => {
  it('matches #occ + digit', () => {
    expect(calendarUidLooksLikeExpandedRecurrence('a#occ2591')).toBe(true)
    expect(calendarUidLooksLikeExpandedRecurrence('a#occ')).toBe(false)
  })
  it('matches /RID=', () => {
    expect(calendarUidLooksLikeExpandedRecurrence('u@i/RID=1')).toBe(true)
  })
})

describe('flattenRipmailListCalendarsJson', () => {
  it('flattens nested list-calendars JSON (googleCalendar primary)', () => {
    const parsed = {
      calendars: [
        {
          sourceId: 'lewiscirne_gmail_com-gcal',
          kind: 'googleCalendar',
          calendars: [{ id: 'primary' }],
          icsUrl: null,
          path: null,
          email: 'lewiscirne@gmail.com',
        },
      ],
    }
    const { sourcesConfigured, availableCalendars } = flattenRipmailListCalendarsJson(parsed)
    expect(sourcesConfigured).toBe(true)
    expect(availableCalendars).toEqual([{ id: 'primary', sourceId: 'lewiscirne_gmail_com-gcal' }])
  })

  it('uses allCalendars when nested calendars is empty', () => {
    const parsed = {
      calendars: [
        {
          sourceId: 'apple-cal',
          kind: 'appleCalendar',
          calendars: [],
          allCalendars: [
            { id: 'cal-1', name: 'Home' },
            { id: 'cal-2', name: 'Work' },
          ],
        },
      ],
    }
    const { sourcesConfigured, availableCalendars } = flattenRipmailListCalendarsJson(parsed)
    expect(sourcesConfigured).toBe(true)
    expect(availableCalendars).toEqual([
      { id: 'cal-1', name: 'Home', sourceId: 'apple-cal' },
      { id: 'cal-2', name: 'Work', sourceId: 'apple-cal' },
    ])
  })

  it('prefers nested calendars when non-empty over allCalendars', () => {
    const parsed = {
      calendars: [
        {
          sourceId: 's',
          calendars: [{ id: 'primary', name: 'Main' }],
          allCalendars: [{ id: 'other', name: 'Other' }],
        },
      ],
    }
    const { availableCalendars } = flattenRipmailListCalendarsJson(parsed)
    expect(availableCalendars).toEqual([{ id: 'primary', name: 'Main', sourceId: 's' }])
  })

  it('returns sourcesConfigured false for empty top-level calendars', () => {
    expect(flattenRipmailListCalendarsJson({ calendars: [] }).sourcesConfigured).toBe(false)
  })

  it('skips calendar rows when sourceId is missing', () => {
    const parsed = {
      calendars: [{ kind: 'googleCalendar', calendars: [{ id: 'orphan' }] }],
    }
    expect(flattenRipmailListCalendarsJson(parsed).availableCalendars).toHaveLength(0)
  })
})

describe('calendarEventsFromRipmailRangeJsonStdout', () => {
  it('parses events array and dedupes by start|end|title', () => {
    const stdout = JSON.stringify({
      events: [
        {
          uid: 'a',
          sourceId: 's1',
          summary: 'Dup',
          startAt: 1000,
          endAt: 2000,
          attendeesJson: JSON.stringify(['x@y.com']),
        },
        {
          uid: 'b',
          sourceId: 's1',
          summary: 'dup ',
          startAt: 1000,
          endAt: 2000,
          attendeesJson: JSON.stringify(['x@y.com', 'z@y.com']),
        },
      ],
    })
    const evs = calendarEventsFromRipmailRangeJsonStdout(stdout)
    expect(evs).toHaveLength(1)
    expect(evs[0].attendees).toHaveLength(2)
  })
})

describe('getCalendarEventsFromRipmail deduplication', () => {
  it('deduplicates events with same start, end, and title', async () => {
    const mockStdout = JSON.stringify({
      events: [
        {
          uid: '3imtvsj7bu6fjf74cphjv2928c_20260420T150000Z',
          sourceId: 'src1',
          summary: 'Weekly Zoom Mtg: Lew/Lana/Ben',
          startAt: 1776711600, // 2026-04-20T19:00:00Z
          endAt: 1776715200,   // 2026-04-20T20:00:00Z
          organizerEmail: 'lewiscirne@gmail.com',
          attendeesJson: JSON.stringify(['lewiscirne@gmail.com', 'lana.k.macrum@jpmorgan.com'])
        },
        {
          uid: '_60q30c1g60o30e1i60o4ac1g60rj8gpl...',
          sourceId: 'src2',
          summary: '  weekly zoom mtg: lew/lana/ben  ',
          startAt: 1776711600,
          endAt: 1776715200,
          organizerEmail: 'lana.k.macrum@jpmorgan.com',
          attendeesJson: JSON.stringify(['lana.k.macrum@jpmorgan.com'])
        }
      ]
    })

    const listCalStdout = JSON.stringify({
      calendars: [
        {
          sourceId: 'src-meta',
          kind: 'googleCalendar',
          calendars: [{ id: 'primary' }],
        },
      ],
    })
    vi.spyOn(ripmailRun, 'execRipmailAsync').mockImplementation(async (cmd: string) => {
      if (cmd.includes('list-calendars')) {
        return { stdout: listCalStdout, stderr: '' }
      }
      if (cmd.includes('calendar range')) {
        return { stdout: mockStdout, stderr: '' }
      }
      return { stdout: '', stderr: '' }
    })

    const result = await getCalendarEventsFromRipmail({ start: '2026-04-20', end: '2026-04-20' })
    
    expect(result.events).toHaveLength(1)
    expect(result.events[0].title).toBe('Weekly Zoom Mtg: Lew/Lana/Ben')
    // Should prefer the one with more attendees
    expect(result.events[0].attendees).toHaveLength(2)
    expect(result.events[0].organizer).toBe('lewiscirne@gmail.com')
    expect(result.meta.sourcesConfigured).toBe(true)
    expect(result.meta.availableCalendars).toEqual([{ id: 'primary', sourceId: 'src-meta' }])
  })
})
