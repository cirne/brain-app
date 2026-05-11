/**
 * calendar queries — range, list-calendars.
 * Reads from calendar_events table populated by IMAP sync / Google Calendar sync.
 * Mirrors ripmail/src/calendar/.
 */

import type { RipmailDb } from './db.js'
import type { CalendarEvent, CalendarRangeResult, CalendarListItem } from './types.js'

interface CalendarEventRow {
  id: number
  source_id: string
  source_kind: string
  calendar_id: string
  calendar_name: string | null
  uid: string
  summary: string | null
  description: string | null
  location: string | null
  start_at: number
  end_at: number
  all_day: number
  timezone: string | null
  status: string | null
  rrule: string | null
  recurrence_json: string | null
  attendees_json: string | null
  organizer_email: string | null
  organizer_name: string | null
  color: string | null
}

function rowToEvent(r: CalendarEventRow): CalendarEvent {
  return {
    uid: r.uid,
    sourceId: r.source_id,
    sourceKind: r.source_kind,
    calendarId: r.calendar_id,
    calendarName: r.calendar_name ?? undefined,
    summary: r.summary,
    description: r.description,
    location: r.location,
    startAt: r.start_at,
    endAt: r.end_at,
    allDay: r.all_day === 1,
    timezone: r.timezone,
    status: r.status,
    rrule: r.rrule,
    recurrenceJson: r.recurrence_json,
    organizerEmail: r.organizer_email,
    organizerName: r.organizer_name,
    attendeesJson: r.attendees_json,
    color: r.color,
  }
}

/**
 * Query calendar events in a time range.
 * `from` and `to` are Unix epoch seconds (as returned by the Rust CLI).
 */
export function calendarRange(
  db: RipmailDb,
  from: number,
  to: number,
  opts?: { sourceIds?: string[]; calendarIds?: string[]; restrictGoogleCalendarIds?: string[] },
): CalendarRangeResult {
  const conditions: string[] = [`start_at <= ? AND end_at >= ?`]
  const params: unknown[] = [to, from]

  if (opts?.sourceIds?.length) {
    const ph = opts.sourceIds.map(() => '?').join(', ')
    conditions.push(`source_id IN (${ph})`)
    params.push(...opts.sourceIds)
  }
  if (opts?.calendarIds?.length) {
    const ph = opts.calendarIds.map(() => '?').join(', ')
    conditions.push(`calendar_id IN (${ph})`)
    params.push(...opts.calendarIds)
  } else if (opts?.restrictGoogleCalendarIds?.length) {
    const ph = opts.restrictGoogleCalendarIds.map(() => '?').join(', ')
    conditions.push(`(source_kind != 'googleCalendar' OR calendar_id IN (${ph}))`)
    params.push(...opts.restrictGoogleCalendarIds)
  }

  const where = conditions.join(' AND ')
  const rows = db
    .prepare(
      `SELECT id, source_id, source_kind, calendar_id, calendar_name, uid, summary, description,
              location, start_at, end_at, all_day, timezone, status, rrule, recurrence_json,
              attendees_json, organizer_email, organizer_name, color
       FROM calendar_events
       WHERE ${where}
       ORDER BY start_at ASC`,
    )
    .all(...params) as CalendarEventRow[]

  const sourcesConfigured = (db.prepare(`SELECT COUNT(*) AS n FROM sources WHERE kind LIKE '%Calendar%' OR kind = 'googleCalendar'`).get() as Record<string, number>)['n'] > 0

  return { events: rows.map(rowToEvent), sourcesConfigured }
}

/**
 * List available calendars from indexed events.
 */
export function calendarListCalendars(
  db: RipmailDb,
  opts?: { sourceIds?: string[] },
): CalendarListItem[] {
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts?.sourceIds?.length) {
    const ph = opts.sourceIds.map(() => '?').join(', ')
    conditions.push(`source_id IN (${ph})`)
    params.push(...opts.sourceIds)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db
    .prepare(
      `SELECT DISTINCT calendar_id, calendar_name, source_id
       FROM calendar_events
       ${where}
       ORDER BY calendar_id`,
    )
    .all(...params) as Array<{ calendar_id: string; calendar_name: string | null; source_id: string }>

  return rows.map((r) => ({
    id: r.calendar_id,
    name: r.calendar_name ?? undefined,
    sourceId: r.source_id,
  }))
}

// ---------------------------------------------------------------------------
// Calendar mutations (create / update / cancel / delete) — SQLite helpers.
// googleCalendar agent/tool cancels and deletes use the live Calendar API (see sync/googleCalendar.ts); this module only edits the local index for non-Google kinds.
// ---------------------------------------------------------------------------

export interface CreateEventOptions {
  sourceId: string
  calendarId: string
  summary: string
  description?: string
  location?: string
  startAt: number
  endAt: number
  allDay?: boolean
  timezone?: string
  attendeesJson?: string
  organizerEmail?: string
}

export function calendarCreateEvent(db: RipmailDb, opts: CreateEventOptions): CalendarEvent {
  const uid = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO calendar_events
    (source_id, source_kind, calendar_id, uid, summary, description, location,
     start_at, end_at, all_day, timezone, attendees_json, organizer_email, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.sourceId, 'local', opts.calendarId, uid,
    opts.summary, opts.description ?? null, opts.location ?? null,
    opts.startAt, opts.endAt, opts.allDay ? 1 : 0,
    opts.timezone ?? null, opts.attendeesJson ?? null,
    opts.organizerEmail ?? null, now,
  )
  return {
    uid, sourceId: opts.sourceId, sourceKind: 'local',
    calendarId: opts.calendarId, summary: opts.summary,
    description: opts.description ?? null, location: opts.location ?? null,
    startAt: opts.startAt, endAt: opts.endAt, allDay: opts.allDay ?? false,
    timezone: opts.timezone ?? null, organizerEmail: opts.organizerEmail ?? null,
  }
}

export function calendarUpdateEvent(
  db: RipmailDb,
  uid: string,
  updates: Partial<Pick<CreateEventOptions, 'summary' | 'description' | 'location' | 'startAt' | 'endAt' | 'allDay' | 'timezone' | 'attendeesJson'>>,
): void {
  const parts: string[] = []
  const vals: unknown[] = []
  if (updates.summary !== undefined) { parts.push('summary = ?'); vals.push(updates.summary) }
  if (updates.description !== undefined) { parts.push('description = ?'); vals.push(updates.description) }
  if (updates.location !== undefined) { parts.push('location = ?'); vals.push(updates.location) }
  if (updates.startAt !== undefined) { parts.push('start_at = ?'); vals.push(updates.startAt) }
  if (updates.endAt !== undefined) { parts.push('end_at = ?'); vals.push(updates.endAt) }
  if (updates.allDay !== undefined) { parts.push('all_day = ?'); vals.push(updates.allDay ? 1 : 0) }
  if (updates.timezone !== undefined) { parts.push('timezone = ?'); vals.push(updates.timezone) }
  if (updates.attendeesJson !== undefined) { parts.push('attendees_json = ?'); vals.push(updates.attendeesJson) }
  if (parts.length === 0) return
  vals.push(uid)
  db.prepare(`UPDATE calendar_events SET ${parts.join(', ')} WHERE uid = ?`).run(...vals)
}

export function calendarCancelEvent(db: RipmailDb, uid: string): void {
  db.prepare(`UPDATE calendar_events SET status = 'cancelled' WHERE uid = ?`).run(uid)
}

export function calendarDeleteEvent(db: RipmailDb, uid: string): void {
  db.prepare(`DELETE FROM calendar_events WHERE uid = ?`).run(uid)
}
