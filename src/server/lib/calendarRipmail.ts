/**
 * Query indexed calendar events via `ripmail calendar range --json` ([OPP-053]).
 */
import { ripmailHomeForBrain } from './brainHome.js'
import { ensureGoogleCalendarSourcesForOAuthImap } from './googleOAuth.js'
import { execRipmailAsync } from './ripmailExec.js'
import { ripmailBin } from './ripmailBin.js'
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
  organizerEmail?: string | null
  attendeesJson?: string | null
  color?: string | null
}

export type CalendarFetchMeta = {
  /** True when config lists at least one calendar source (googleCalendar, ics*, etc.). */
  sourcesConfigured: boolean
  /** ISO timestamp or empty when unknown */
  ripmail: string
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

  return {
    id: `${sourceId}:${uid}`,
    title: (row.summary ?? '').trim() || '(No title)',
    start,
    end,
    allDay,
    source: source as CalendarEvent['source'],
    location: row.location?.trim() || undefined,
    description: row.description?.trim()?.slice(0, 2000) || undefined,
    attendees,
    organizer,
    color: row.color?.trim() || undefined,
  }
}

async function ripmailCalendarSourcesConfigured(): Promise<boolean> {
  try {
    const { stdout } = await execRipmailAsync(
      `${ripmailBin()} calendar list-calendars --json`,
      { timeout: 15000 },
    )
    const j = JSON.parse(stdout) as { calendars?: unknown[] }
    return Array.isArray(j.calendars) && j.calendars.length > 0
  } catch {
    return false
  }
}

/**
 * Fetch events in [start, end] inclusive (YYYY-MM-DD) from the ripmail index.
 */
export async function getCalendarEventsFromRipmail(opts: {
  start?: string
  end?: string
}): Promise<{ events: CalendarEvent[]; meta: CalendarFetchMeta }> {
  await ensureGoogleCalendarSourcesForOAuthImap(ripmailHomeForBrain())
  const start = opts.start?.trim()
  const end = opts.end?.trim()
  if (!start || !end) {
    const sourcesConfigured = await ripmailCalendarSourcesConfigured()
    return {
      events: [],
      meta: {
        sourcesConfigured,
        ripmail: '',
      },
    }
  }

  const [sourcesConfigured, cmdOut] = await Promise.all([
    ripmailCalendarSourcesConfigured(),
    execRipmailAsync(
      `${ripmailBin()} calendar range --from ${JSON.stringify(start)} --to ${JSON.stringify(end)} --json`,
      { timeout: 60000 },
    ).catch(() => null),
  ])

  if (!cmdOut) {
    return { events: [], meta: { sourcesConfigured, ripmail: '' } }
  }

  let parsed: { events?: RipmailCalendarEventJson[] }
  try {
    parsed = JSON.parse(cmdOut.stdout) as { events?: RipmailCalendarEventJson[] }
  } catch {
    return { events: [], meta: { sourcesConfigured, ripmail: '' } }
  }

  const raw = Array.isArray(parsed.events) ? parsed.events : []
  const events: CalendarEvent[] = []
  for (const r of raw) {
    const ev = mapRipmailRowToCalendarEvent(r)
    if (ev) events.push(ev)
  }
  events.sort((a, b) => a.start.localeCompare(b.start))

  return {
    events,
    meta: {
      sourcesConfigured,
      ripmail: new Date().toISOString(),
    },
  }
}
