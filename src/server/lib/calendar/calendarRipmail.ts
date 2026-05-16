/**
 * Query indexed calendar events via the in-process TS ripmail module.
 */
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { ensureGoogleOAuthImapSiblingSources } from '@server/lib/platform/googleOAuth.js'
import { collectGoogleCalendarDefaultCalendarIds, loadRipmailConfig } from '@server/ripmail/sync/config.js'
import { prepareRipmailDb } from '@server/ripmail/db.js'
import { calendarRange, calendarListCalendars } from '@server/ripmail/calendar.js'
import type { CalendarEvent } from './calendarCache.js'

export type RipmailCalendarEventJson = {
  uid?: string
  sourceId?: string
  sourceKind?: string
  calendarId?: string
  summary?: string | null
  description?: string | null
  location?: string | null
  startAt?: number
  endAt?: number
  allDay?: number | boolean
  /** ICS RRULE line when indexed from ICS (one row per VEVENT). */
  rrule?: string | null
  /** Google Calendar API `recurrence` array serialized to string (expanded instances still carry it). */
  recurrenceJson?: string | null
  organizerEmail?: string | null
  attendeesJson?: string | null
  color?: string | null
}

export type CalendarFetchMeta = {
  /** True when config lists at least one calendar source (googleCalendar, ics*, etc.). */
  sourcesConfigured: boolean
  /** ISO timestamp or empty when unknown */
  ripmail: string
  /** Available calendars (cached from the same ripmail call that checks sourcesConfigured) */
  availableCalendars?: { id: string; name?: string; sourceId: string }[]
}

/**
 * Expanded instance UIDs often omit `rrule` / `recurrence_json` in the index (Apple CalDAV, Google).
 * Detect common suffixes so adaptive tiers can drop standing meetings.
 */
export function calendarUidLooksLikeExpandedRecurrence(uid?: string | null): boolean {
  const u = uid?.trim() ?? ''
  if (!u) return false
  if (/\/RID=/i.test(u)) return true
  if (/#occ\d/i.test(u)) return true
  return false
}

/** True when ripmail row is part of a recurring series (RRULE, recurrence array, or expanded-instance UID). */
export function eventIsRecurringFromRipmailRow(
  rrule?: string | null,
  recurrenceJson?: string | null,
  uid?: string | null,
): boolean {
  if (typeof rrule === 'string' && rrule.trim().length > 0) return true
  if (recurrenceJson?.trim()) {
    try {
      const raw = JSON.parse(recurrenceJson) as unknown
      if (Array.isArray(raw) && raw.length > 0) return true
    } catch {
      /* fall through */
    }
  }
  return calendarUidLooksLikeExpandedRecurrence(uid)
}

function parseAttendees(attendeesJson: string | null | undefined): string[] | undefined {
  if (!attendeesJson?.trim()) return undefined
  try {
    const raw = JSON.parse(attendeesJson) as unknown
    if (Array.isArray(raw)) {
      const emails: string[] = []
      for (const x of raw) {
        if (typeof x === 'string' && x.includes('@')) emails.push(x.toLowerCase())
        else if (x && typeof x === 'object' && 'email' in x && typeof (x as { email?: string }).email === 'string') {
          emails.push((x as { email: string }).email.toLowerCase())
        }
      }
      return emails.length > 0 ? emails : undefined
    }
  } catch {
    /* ignore */
  }
  return undefined
}

function unixToIso(startAt: number, endAt: number, allDay: boolean): { start: string; end: string } {
  if (allDay) {
    const s = new Date(startAt * 1000)
    const e = new Date(endAt * 1000)
    // Matches ICS: all-day `end` is exclusive (day after last day); ripmail stores the same.
    return {
      start: s.toISOString().slice(0, 10),
      end: e.toISOString().slice(0, 10),
    }
  }
  const iso = (ts: number) => new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  return { start: iso(startAt), end: iso(endAt) }
}

/** Map one ripmail JSON row to brain `CalendarEvent`. */
export function mapRipmailRowToCalendarEvent(row: RipmailCalendarEventJson): CalendarEvent | null {
  const uid = row.uid?.trim()
  const sourceId = row.sourceId?.trim() ?? 'unknown'
  if (!uid || row.startAt === undefined || row.endAt === undefined) return null
  const allDay = row.allDay === true || row.allDay === 1
  const { start, end } = unixToIso(row.startAt, row.endAt, allDay)
  const source = (row.sourceKind ?? 'ripmail').trim() || 'ripmail'
  const attendees = parseAttendees(row.attendeesJson)
  const organizer = row.organizerEmail?.trim()?.toLowerCase()
  const recurring = eventIsRecurringFromRipmailRow(row.rrule, row.recurrenceJson, uid)

  return {
    id: `${sourceId}:${uid}`,
    title: (row.summary ?? '').trim() || '(No title)',
    start,
    end,
    allDay,
    source: source as CalendarEvent['source'],
    calendarId: row.calendarId?.trim() || undefined,
    location: row.location?.trim() || undefined,
    description: row.description?.trim()?.slice(0, 2000) || undefined,
    attendees,
    recurring,
    organizer,
    color: row.color?.trim() || undefined,
  }
}

/**
 * Parse `ripmail calendar range --json` / `calendar search --json` stdout `{ "events": [...] }`
 * into deduplicated sorted `CalendarEvent`s.
 */
export function calendarEventsFromRipmailRangeJsonStdout(stdout: string): CalendarEvent[] {
  let parsed: { events?: RipmailCalendarEventJson[] }
  try {
    parsed = JSON.parse(stdout) as { events?: RipmailCalendarEventJson[] }
  } catch {
    return []
  }
  const raw = Array.isArray(parsed.events) ? parsed.events : []
  const events: CalendarEvent[] = []
  const seen = new Map<string, CalendarEvent>()

  for (const r of raw) {
    const ev = mapRipmailRowToCalendarEvent(r)
    if (!ev) continue
    const key = `${ev.start}|${ev.end}|${ev.title.trim().toLowerCase()}`
    const existing = seen.get(key)
    if (existing) {
      const existingAttendees = existing.attendees?.length ?? 0
      const newAttendees = ev.attendees?.length ?? 0
      if (newAttendees > existingAttendees) {
        seen.set(key, ev)
      }
    } else {
      seen.set(key, ev)
    }
  }

  for (const ev of seen.values()) {
    events.push(ev)
  }
  events.sort((a, b) => a.start.localeCompare(b.start))
  return events
}

export type RipmailListCalendarRow = { id: string; name?: string; sourceId: string }

/**
 * Normalizes `ripmail calendar list-calendars --json` stdout: top-level `calendars` is an array of
 * **sources**, each with nested `calendars` (configured ids) and optional `allCalendars` (names index).
 */
export function flattenRipmailListCalendarsJson(parsed: unknown): {
  sourcesConfigured: boolean
  availableCalendars: RipmailListCalendarRow[]
} {
  if (!parsed || typeof parsed !== 'object') {
    return { sourcesConfigured: false, availableCalendars: [] }
  }
  const sourceRows = Array.isArray((parsed as { calendars?: unknown }).calendars)
    ? ((parsed as { calendars: unknown[] }).calendars as unknown[])
    : []
  const sourcesConfigured = sourceRows.length > 0
  const availableCalendars: RipmailListCalendarRow[] = []

  const pushEntries = (entries: unknown[], sourceId: string) => {
    for (const e of entries) {
      if (!e || typeof e !== 'object') continue
      const o = e as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id.trim() : ''
      if (!id) continue
      const rawName = typeof o.name === 'string' ? o.name.trim() : ''
      const row: RipmailListCalendarRow = { id, sourceId }
      if (rawName.length > 0) row.name = rawName
      availableCalendars.push(row)
    }
  }

  for (const row of sourceRows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const sourceId = typeof r.sourceId === 'string' ? r.sourceId.trim() : ''
    if (!sourceId) continue

    const nested = r.calendars
    if (Array.isArray(nested) && nested.length > 0) {
      pushEntries(nested, sourceId)
      continue
    }
    const allCals = r.allCalendars
    if (Array.isArray(allCals) && allCals.length > 0) {
      pushEntries(allCals, sourceId)
    }
  }

  return { sourcesConfigured, availableCalendars }
}

export type RipmailCalendarRangeFilterOpts = {
  calendarIds?: string[]
  restrictGoogleCalendarIds?: string[]
}

/**
 * Agents often pass `calendar_ids: ["primary"]` for day checks; Hub day-view may use a
 * different default (e.g. the user's Gmail calendar id). Treat lone `primary` like omitted
 * when configured defaults differ.
 */
export function normalizeRangeCalendarIdsRequest(
  ripmailHome: string,
  requested?: string[],
): string[] | undefined {
  const trimmed = requested?.map((id) => id.trim()).filter(Boolean) ?? []
  if (trimmed.length !== 1 || trimmed[0]!.toLowerCase() !== 'primary') return trimmed.length > 0 ? trimmed : undefined
  const defaults = collectGoogleCalendarDefaultCalendarIds(loadRipmailConfig(ripmailHome))
  const defaultIsOnlyPrimary =
    defaults.length === 1 && defaults[0]!.toLowerCase() === 'primary'
  if (defaults.length > 0 && !defaultIsOnlyPrimary) return undefined
  return trimmed
}

/**
 * When tools/API omit `calendar_ids`, restrict indexed **Google** rows to Hub `defaultCalendars`
 * (or the sole synced calendar id). Non-`googleCalendar` rows stay visible.
 */
export function resolveRipmailRangeCalendarFilter(
  ripmailHome: string,
  requested?: string[],
): RipmailCalendarRangeFilterOpts | undefined {
  const trimmedRequested = normalizeRangeCalendarIdsRequest(ripmailHome, requested) ?? []
  if (trimmedRequested.length > 0) return { calendarIds: trimmedRequested }
  const defaults = collectGoogleCalendarDefaultCalendarIds(loadRipmailConfig(ripmailHome))
  if (defaults.length > 0) return { restrictGoogleCalendarIds: defaults }
  return undefined
}

async function ripmailCalendarSourcesInfo(): Promise<{ configured: boolean; calendars: RipmailListCalendarRow[] }> {
  try {
    const db = await prepareRipmailDb(ripmailHomeForBrain())
    const items = calendarListCalendars(db)
    const configured = items.length > 0
    const calendars: RipmailListCalendarRow[] = items.map((c) => ({
      id: c.id,
      name: c.name,
      sourceId: c.sourceId,
    }))
    return { configured, calendars }
  } catch {
    return { configured: false, calendars: [] }
  }
}

/**
 * Fetch events in [start, end] inclusive (YYYY-MM-DD) from the ripmail index.
 */
export async function getCalendarEventsFromRipmail(opts: {
  start?: string
  end?: string
  calendarIds?: string[]
}): Promise<{ events: CalendarEvent[]; meta: CalendarFetchMeta }> {
  await ensureGoogleOAuthImapSiblingSources(ripmailHomeForBrain())
  const start = opts.start?.trim()
  const end = opts.end?.trim()
  if (!start || !end) {
    const info = await ripmailCalendarSourcesInfo()
    return {
      events: [],
      meta: {
        sourcesConfigured: info.configured,
        availableCalendars: info.calendars,
        ripmail: '',
      },
    }
  }

  // Convert ISO date strings to Unix epoch seconds
  const fromUnix = Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000)
  const toUnix = Math.floor(new Date(end + 'T23:59:59Z').getTime() / 1000)

  const [info, rangeResult] = await Promise.all([
    ripmailCalendarSourcesInfo(),
    (async () => {
      try {
        const ripHome = ripmailHomeForBrain()
        const db = await prepareRipmailDb(ripHome)
        const rangeOpts = resolveRipmailRangeCalendarFilter(ripHome, opts.calendarIds)
        return calendarRange(db, fromUnix, toUnix, rangeOpts)
      } catch {
        return null
      }
    })(),
  ])

  if (!rangeResult) {
    return { events: [], meta: { sourcesConfigured: info.configured, availableCalendars: info.calendars, ripmail: '' } }
  }

  // Map TS ripmail CalendarEvent to RipmailCalendarEventJson (shapes are compatible)
  const events = calendarEventsFromRipmailRangeJsonStdout(
    JSON.stringify({ events: rangeResult.events }),
  )

  return {
    events,
    meta: {
      sourcesConfigured: info.configured,
      availableCalendars: info.calendars,
      ripmail: new Date().toISOString(),
    },
  }
}
