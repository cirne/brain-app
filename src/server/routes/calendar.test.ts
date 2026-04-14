import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { parseICS } from '../lib/calendarCache.js'

// ─── ICS fixture ────────────────────────────────────────────────────────────

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:meeting-001@test
SUMMARY:Weekly Sync
DTSTART:20260412T100000Z
DTEND:20260412T110000Z
LOCATION:Zoom
ORGANIZER;CN=Alice:mailto:alice@example.com
ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED:mailto:bob@example.com
ATTENDEE;CN=Charlie:mailto:charlie@example.com
END:VEVENT
BEGIN:VEVENT
UID:travel-001@test
SUMMARY:NYC Trip
DTSTART;VALUE=DATE:20260412
DTEND;VALUE=DATE:20260415
END:VEVENT
BEGIN:VEVENT
UID:meeting-002@test
SUMMARY:1:1 with Alice
DTSTART;TZID=America/New_York:20260413T140000
DTEND;TZID=America/New_York:20260413T150000
END:VEVENT
END:VCALENDAR`

const FOLDED_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:fold-001@test
SUMMARY:This is a very long summa
 ry that got folded
DTSTART:20260414T090000Z
DTEND:20260414T100000Z
END:VEVENT
END:VCALENDAR`

// ─── Route fixture ───────────────────────────────────────────────────────────

let cacheDir: string
let app: Hono

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'calendar-test-'))
  process.env.CALENDAR_CACHE_DIR = cacheDir
  process.env.CIRNE_TRAVEL_ICS_URL = ''
  process.env.LEW_PERSONAL_ICS_URL = ''

  vi.resetModules()
  const { default: calendarRoute } = await import('./calendar.js')
  app = new Hono()
  app.route('/api/calendar', calendarRoute)
})

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true })
  delete process.env.CALENDAR_CACHE_DIR
  delete process.env.CIRNE_TRAVEL_ICS_URL
  delete process.env.LEW_PERSONAL_ICS_URL
  vi.resetModules()
})

// ─── parseICS unit tests ─────────────────────────────────────────────────────

describe('parseICS', () => {
  it('parses a timed UTC event', () => {
    const events = parseICS(SAMPLE_ICS, 'personal')
    const meeting = events.find(e => e.id === 'meeting-001@test')
    expect(meeting).toBeDefined()
    expect(meeting!.title).toBe('Weekly Sync')
    expect(meeting!.start).toBe('2026-04-12T10:00:00Z')
    expect(meeting!.end).toBe('2026-04-12T11:00:00Z')
    expect(meeting!.allDay).toBe(false)
    expect(meeting!.source).toBe('personal')
    expect(meeting!.location).toBe('Zoom')
  })

  it('parses an all-day event', () => {
    const events = parseICS(SAMPLE_ICS, 'travel')
    const trip = events.find(e => e.id === 'travel-001@test')
    expect(trip).toBeDefined()
    expect(trip!.title).toBe('NYC Trip')
    expect(trip!.start).toBe('2026-04-12')
    expect(trip!.end).toBe('2026-04-15')
    expect(trip!.allDay).toBe(true)
    expect(trip!.source).toBe('travel')
  })

  it('parses an event with TZID parameter', () => {
    const events = parseICS(SAMPLE_ICS, 'personal')
    const meeting = events.find(e => e.id === 'meeting-002@test')
    expect(meeting).toBeDefined()
    expect(meeting!.title).toBe('1:1 with Alice')
    expect(meeting!.allDay).toBe(false)
    // start should contain a valid ISO date prefix
    expect(meeting!.start).toMatch(/^2026-04-13/)
  })

  it('unfolds continuation lines', () => {
    const events = parseICS(FOLDED_ICS, 'personal')
    expect(events[0].title).toBe('This is a very long summary that got folded')
  })

  it('sorts events by start date', () => {
    const events = parseICS(SAMPLE_ICS, 'personal')
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].start.localeCompare(events[i].start)).toBeLessThanOrEqual(0)
    }
  })

  it('expands a weekly RRULE into individual occurrences', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:weekly-001@test
SUMMARY:Weekly Standup
DTSTART:20260413T140000Z
DTEND:20260413T143000Z
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
END:VCALENDAR`
    const events = parseICS(ics, 'personal')
    const standups = events.filter(e => e.title === 'Weekly Standup')
    expect(standups).toHaveLength(3)
    expect(standups[0].start).toBe('2026-04-13T14:00:00Z')
    expect(standups[1].start).toBe('2026-04-20T14:00:00Z')
    expect(standups[2].start).toBe('2026-04-27T14:00:00Z')
    // Expanded events get unique IDs
    expect(new Set(standups.map(e => e.id)).size).toBe(3)
  })

  it('deduplicates RRULE occurrences that have a RECURRENCE-ID override', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:weekly-002@test
SUMMARY:Weekly Standup
DTSTART:20260413T140000Z
DTEND:20260413T143000Z
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:weekly-002@test
SUMMARY:Weekly Standup (rescheduled)
DTSTART:20260420T150000Z
DTEND:20260420T153000Z
RECURRENCE-ID:20260420T140000Z
END:VEVENT
END:VCALENDAR`
    const events = parseICS(ics, 'personal')
    const standups = events.filter(e => e.title.startsWith('Weekly Standup'))
    // Should have 3 total: Apr 13 (RRULE), Apr 20 override (not duplicated), Apr 27 (RRULE)
    expect(standups).toHaveLength(3)
    const apr20 = standups.find(e => e.start.startsWith('2026-04-20'))
    expect(apr20).toBeDefined()
    expect(apr20!.title).toBe('Weekly Standup (rescheduled)')
    expect(apr20!.start).toBe('2026-04-20T15:00:00Z')
  })

  it('parses ATTENDEE and ORGANIZER emails', () => {
    const events = parseICS(SAMPLE_ICS, 'personal')
    const meeting = events.find(e => e.id === 'meeting-001@test')
    expect(meeting).toBeDefined()
    expect(meeting!.organizer).toBe('alice@example.com')
    expect(meeting!.attendees).toEqual(['bob@example.com', 'charlie@example.com'])
  })

  it('omits attendees/organizer when not in ICS', () => {
    const events = parseICS(SAMPLE_ICS, 'travel')
    const trip = events.find(e => e.id === 'travel-001@test')
    expect(trip!.attendees).toBeUndefined()
    expect(trip!.organizer).toBeUndefined()
  })

  it('unescapes ICS special characters', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:escape-001@test
SUMMARY:Lunch\\, catch-up\\nand coffee
DTSTART:20260412T120000Z
DTEND:20260412T130000Z
END:VEVENT
END:VCALENDAR`
    const events = parseICS(ics, 'personal')
    expect(events[0].title).toBe('Lunch, catch-up\nand coffee')
  })
})

// ─── GET /api/calendar ───────────────────────────────────────────────────────

describe('GET /api/calendar', () => {
  it('returns empty events when cache is missing', async () => {
    const res = await app.request('/api/calendar')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual([])
    expect(body.fetchedAt).toEqual({ travel: '', personal: '' })
  })

  it('returns events filtered by date range', async () => {
    // Pre-populate cache
    const { writeCache } = await import('../lib/calendarCache.js')
    await writeCache('personal', [
      {
        id: 'e1', title: 'Before', start: '2026-04-10T10:00:00Z', end: '2026-04-10T11:00:00Z',
        allDay: false, source: 'personal',
      },
      {
        id: 'e2', title: 'In Range', start: '2026-04-12T10:00:00Z', end: '2026-04-12T11:00:00Z',
        allDay: false, source: 'personal',
      },
      {
        id: 'e3', title: 'After', start: '2026-04-20T10:00:00Z', end: '2026-04-20T11:00:00Z',
        allDay: false, source: 'personal',
      },
    ])

    const res = await app.request('/api/calendar?start=2026-04-11&end=2026-04-15')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toHaveLength(1)
    expect(body.events[0].id).toBe('e2')
  })

  it('includes all-day events that span into the range', async () => {
    const { writeCache } = await import('../lib/calendarCache.js')
    await writeCache('travel', [
      {
        id: 't1', title: 'Long Trip', start: '2026-04-10', end: '2026-04-20',
        allDay: true, source: 'travel',
      },
    ])

    const res = await app.request('/api/calendar?start=2026-04-12&end=2026-04-14')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toHaveLength(1)
    expect(body.events[0].id).toBe('t1')
  })

  it('combines travel and personal events', async () => {
    const { writeCache } = await import('../lib/calendarCache.js')
    await Promise.all([
      writeCache('travel', [{ id: 't1', title: 'Trip', start: '2026-04-12', end: '2026-04-13', allDay: true, source: 'travel' }]),
      writeCache('personal', [{ id: 'p1', title: 'Meeting', start: '2026-04-12T10:00:00Z', end: '2026-04-12T11:00:00Z', allDay: false, source: 'personal' }]),
    ])

    const res = await app.request('/api/calendar?start=2026-04-12&end=2026-04-12')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toHaveLength(2)
    const sources = body.events.map((e: { source: string }) => e.source)
    expect(sources).toContain('travel')
    expect(sources).toContain('personal')
  })
})

// ─── GET /api/calendar/related ───────────────────────────────────────────────

describe('GET /api/calendar/related', () => {
  it('returns JSON shape with empty arrays when no event matches', async () => {
    const res = await app.request('/api/calendar/related?eventId=does-not-exist')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.emails)).toBe(true)
    expect(Array.isArray(body.wiki)).toBe(true)
    expect(Array.isArray(body.people)).toBe(true)
    expect(body.emails).toHaveLength(0)
    expect(body.wiki).toHaveLength(0)
    expect(body.people).toHaveLength(0)
  })

  it('accepts meetingIds without eventId (still 200)', async () => {
    const res = await app.request('/api/calendar/related?meetingIds=abc,def')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('emails')
    expect(body).toHaveProperty('wiki')
    expect(body).toHaveProperty('people')
  })

  it('loads event from cache for attendee/organizer lookup (title < 3 chars skips wiki grep)', async () => {
    const { writeCache } = await import('../lib/calendarCache.js')
    await writeCache('personal', [
      {
        id: 'rel-ev-1',
        title: 'zz',
        start: '2026-04-12T10:00:00Z',
        end: '2026-04-12T11:00:00Z',
        allDay: false,
        source: 'personal',
        organizer: 'org@example.com',
        attendees: ['a@example.com', 'b@example.com'],
      },
    ])

    const res = await app.request('/api/calendar/related?eventId=rel-ev-1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.emails)).toBe(true)
    expect(Array.isArray(body.wiki)).toBe(true)
    expect(Array.isArray(body.people)).toBe(true)
  })
})

// ─── POST /api/calendar/sync ─────────────────────────────────────────────────

describe('POST /api/calendar/sync', () => {
  it('returns ok when no ICS URLs are configured', async () => {
    const res = await app.request('/api/calendar/sync', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns ok:false when ICS URL returns an error', async () => {
    process.env.LEW_PERSONAL_ICS_URL = 'http://localhost:9/nonexistent'
    vi.resetModules()
    const { default: freshRoute } = await import('./calendar.js')
    const freshApp = new Hono()
    freshApp.route('/api/calendar', freshRoute)

    const res = await freshApp.request('/api/calendar/sync', { method: 'POST' })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
  })
})
