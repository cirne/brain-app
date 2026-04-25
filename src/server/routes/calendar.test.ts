import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { CalendarEvent } from '@server/lib/calendar/calendarCache.js'
import { getCalendarEventsFromRipmail } from '@server/lib/calendar/calendarRipmail.js'
import { syncCalendarSourcesRipmail, syncInboxRipmail } from '@server/lib/platform/syncAll.js'

vi.mock('@server/lib/calendar/calendarRipmail.js', () => ({
  getCalendarEventsFromRipmail: vi.fn(),
}))

vi.mock('@server/lib/platform/syncAll.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/lib/platform/syncAll.js')>()
  return {
    ...actual,
    syncInboxRipmail: vi.fn().mockResolvedValue({ ok: true }),
    syncCalendarSourcesRipmail: vi.fn().mockResolvedValue({ ok: true }),
  }
})

let brainHome: string
let app: Hono

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'calendar-test-'))
  process.env.BRAIN_HOME = brainHome

  vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
    events: [],
    meta: { sourcesConfigured: false, ripmail: '' },
  })
  vi.mocked(syncInboxRipmail).mockResolvedValue({ ok: true })
  vi.mocked(syncCalendarSourcesRipmail).mockResolvedValue({ ok: true })

  vi.resetModules()
  const { default: calendarRoute } = await import('./calendar.js')
  app = new Hono()
  app.route('/api/calendar', calendarRoute)
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.resetModules()
})

// ─── GET /api/calendar ───────────────────────────────────────────────────────

describe('GET /api/calendar', () => {
  it('returns empty events when ripmail has none', async () => {
    const res = await app.request('/api/calendar')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual([])
    expect(body.fetchedAt).toEqual({ ripmail: '' })
    expect(body.sourcesConfigured).toBe(false)
  })

  it('passes date range to ripmail adapter', async () => {
    vi.mocked(getCalendarEventsFromRipmail).mockResolvedValueOnce({
      events: [
        {
          id: 'e2',
          title: 'In Range',
          start: '2026-04-12T10:00:00Z',
          end: '2026-04-12T11:00:00Z',
          allDay: false,
          source: 'googleCalendar',
        },
      ],
      meta: { sourcesConfigured: true, ripmail: '2026-01-01T00:00:00.000Z' },
    })

    const res = await app.request('/api/calendar?start=2026-04-11&end=2026-04-15')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toHaveLength(1)
    expect(body.events[0].id).toBe('e2')
    expect(vi.mocked(getCalendarEventsFromRipmail)).toHaveBeenCalledWith({
      start: '2026-04-11',
      end: '2026-04-15',
    })
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

  it('loads event from getCalendarEvents for attendee lookup', async () => {
    const ev: CalendarEvent = {
      id: 'rel-ev-1',
      title: 'zz',
      start: '2026-04-12T10:00:00Z',
      end: '2026-04-12T11:00:00Z',
      allDay: false,
      source: 'googleCalendar',
      organizer: 'org@example.com',
      attendees: ['a@example.com', 'b@example.com'],
    }
    vi.mocked(getCalendarEventsFromRipmail).mockResolvedValue({
      events: [ev],
      meta: { sourcesConfigured: true, ripmail: 'x' },
    })

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
  it('returns ok when inbox sync succeeds', async () => {
    const res = await app.request('/api/calendar/sync', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(syncInboxRipmail)).toHaveBeenCalled()
  })

  it('returns 500 when inbox sync fails', async () => {
    vi.mocked(syncInboxRipmail).mockResolvedValueOnce({ ok: false, error: 'sync failed' })
    const res = await app.request('/api/calendar/sync', { method: 'POST' })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('sync failed')
  })
})

// ─── POST /api/calendar/refresh ──────────────────────────────────────────────

describe('POST /api/calendar/refresh', () => {
  it('returns ok when calendar-only sync succeeds', async () => {
    vi.mocked(syncCalendarSourcesRipmail).mockClear()
    const res = await app.request('/api/calendar/refresh', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(vi.mocked(syncCalendarSourcesRipmail)).toHaveBeenCalled()
  })

  it('returns 500 when calendar-only sync fails', async () => {
    vi.mocked(syncCalendarSourcesRipmail).mockResolvedValueOnce({ ok: false, error: 'cal failed' })
    const res = await app.request('/api/calendar/refresh', { method: 'POST' })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('cal failed')
  })
})
