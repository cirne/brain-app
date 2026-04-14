import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import rrulePkg from 'rrule'
const { RRule, RRuleSet } = rrulePkg

export interface CalendarEvent {
  id: string
  title: string
  /** ISO date string: "YYYY-MM-DD" for all-day, "YYYY-MM-DDTHH:MM:SSZ" for timed */
  start: string
  /** ISO date string. For all-day events DTEND is exclusive (day after last day). */
  end: string
  allDay: boolean
  source: 'travel' | 'personal'
  location?: string
  description?: string
  /** Email addresses of attendees (from ICS ATTENDEE mailto:). */
  attendees?: string[]
  /** Email address of organizer (from ICS ORGANIZER mailto:). */
  organizer?: string
}

interface Cache {
  fetchedAt: string
  events: CalendarEvent[]
}

// Lazy: read from process.env at call time so .env loaded in index.ts takes effect
export const cacheDir = () => process.env.CALENDAR_CACHE_DIR ?? './data/calendar'

/** Unfold ICS continuation lines (CRLF or LF followed by space/tab). */
function unfold(ics: string): string {
  return ics.replace(/\r?\n[ \t]/g, '')
}

/** Parse an ICS datetime value + its property key into a JS Date (UTC). */
function parseICSDate(value: string, propKey: string): { date: Date; allDay: boolean } {
  const allDay = propKey.includes('VALUE=DATE') || value.length === 8
  if (allDay) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    return { date: new Date(iso + 'T00:00:00Z'), allDay: true }
  }
  if (value.endsWith('Z')) {
    // Explicit UTC: parse directly
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T` +
      `${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`
    return { date: new Date(iso), allDay: false }
  }
  // TZID local time — extract timezone from propKey, convert to UTC
  const tzMatch = propKey.match(/TZID=["']?([^"';:]+)["']?/)
  const tz = tzMatch?.[1] ?? 'UTC'
  const localIso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T` +
    `${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`
  // Use Intl to compute UTC offset for this tz at this instant
  const approx = new Date(localIso + 'Z')
  const offsetMs = approx.getTime() - new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(approx).replace(/(\d{4})-(\d{2})-(\d{2}), (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6Z')
  ).getTime()
  return { date: new Date(approx.getTime() + offsetMs), allDay: false }
}

function toISO(date: Date, allDay: boolean): string {
  if (allDay) return date.toISOString().slice(0, 10)
  return date.toISOString().replace(/\.000Z$/, 'Z')
}

function unescapeICS(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

// Expand recurring events up to this many days into the future from today
const RRULE_WINDOW_DAYS = 365

interface ParsedVEvent {
  props: Record<string, string>
  dtStartKey: string
  startParsed: { date: Date; allDay: boolean }
  uid: string
}

/** Extract mailto: addresses from all ATTENDEE props in a VEVENT. */
function extractAttendeeEmails(props: Record<string, string>): string[] | undefined {
  const emails: string[] = []
  const seen = new Set<string>()
  for (const [key, val] of Object.entries(props)) {
    if (key !== 'ATTENDEE' && !key.startsWith('ATTENDEE;')) continue
    const m = val.match(/^mailto:(.+)/i) ?? val.match(/mailto:([^\s;]+)/i)
    if (m) {
      const email = m[1].toLowerCase()
      if (!seen.has(email)) { seen.add(email); emails.push(email) }
    }
  }
  return emails.length > 0 ? emails : undefined
}

/** Extract mailto: address from the ORGANIZER prop. */
function extractOrganizerEmail(props: Record<string, string>): string | undefined {
  for (const [key, val] of Object.entries(props)) {
    if (key !== 'ORGANIZER' && !key.startsWith('ORGANIZER;')) continue
    const m = val.match(/^mailto:(.+)/i) ?? val.match(/mailto:([^\s;]+)/i)
    if (m) return m[1].toLowerCase()
  }
  return undefined
}

/** Parse an ICS text blob into CalendarEvent objects, expanding RRULE recurrences. */
export function parseICS(icsText: string, source: 'travel' | 'personal'): CalendarEvent[] {
  const lines = unfold(icsText).split(/\r?\n/)
  const events: CalendarEvent[] = []
  // uid → set of ISO start strings for RECURRENCE-ID overrides
  const recurrenceOverrides = new Map<string, Set<string>>()
  // Collect all VEVENTs first so we can apply overrides when expanding RRULEs
  const vevents: ParsedVEvent[] = []
  let inEvent = false
  let current: Record<string, string> = {}

  const windowEnd = new Date(Date.now() + RRULE_WINDOW_DAYS * 86400 * 1000)

  // Pass 1: collect raw VEVENTs
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; current = {}; continue }
    if (line === 'END:VEVENT') {
      inEvent = false
      const dtStartKey = Object.keys(current).find(k => k === 'DTSTART' || k.startsWith('DTSTART;'))
      if (dtStartKey) {
        const uid = current['UID'] ?? crypto.randomUUID()
        const startParsed = parseICSDate(current[dtStartKey], dtStartKey)
        // Track RECURRENCE-ID overrides so we can exclude those dates from RRULE expansion
        const recurrenceIdKey = Object.keys(current).find(k => k === 'RECURRENCE-ID' || k.startsWith('RECURRENCE-ID;'))
        if (recurrenceIdKey) {
          const overrideDate = parseICSDate(current[recurrenceIdKey], recurrenceIdKey)
          if (!recurrenceOverrides.has(uid)) recurrenceOverrides.set(uid, new Set())
          recurrenceOverrides.get(uid)!.add(overrideDate.date.toISOString())
        }
        vevents.push({ props: current, dtStartKey, startParsed, uid })
      }
      current = {}
      continue
    }
    if (!inEvent) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue
    current[line.slice(0, colonIdx)] = line.slice(colonIdx + 1)
  }

  // Pass 2: emit events
  for (const { props, dtStartKey, startParsed, uid } of vevents) {
    const dtEndKey = Object.keys(props).find(k => k === 'DTEND' || k.startsWith('DTEND;'))
    const endStr = dtEndKey ? props[dtEndKey] : props[dtStartKey]
    const endParsed = parseICSDate(endStr, dtEndKey ?? dtStartKey)
    const duration = endParsed.date.getTime() - startParsed.date.getTime()

    const title = unescapeICS(props['SUMMARY'] ?? '(No title)')
    const location = props['LOCATION'] ? unescapeICS(props['LOCATION']) : undefined
    const description = props['DESCRIPTION']
      ? unescapeICS(props['DESCRIPTION']).slice(0, 500)
      : undefined

    const attendees = extractAttendeeEmails(props)
    const organizer = extractOrganizerEmail(props)

    // RECURRENCE-ID overrides are emitted as standalone events (skip RRULE path)
    const isOverride = Object.keys(props).some(k => k === 'RECURRENCE-ID' || k.startsWith('RECURRENCE-ID;'))

    const rruleStr = props['RRULE']
    if (rruleStr && !isOverride) {
      // Expand recurrence into individual occurrences within the window
      const overrideDates = recurrenceOverrides.get(uid) ?? new Set<string>()
      try {
        const rset = new RRuleSet()
        // Use already-converted UTC date so TZID events expand correctly
        const rule = new RRule({ ...RRule.parseString(rruleStr), dtstart: startParsed.date })
        rset.rrule(rule)
        // Add EXDATEs
        Object.keys(props).filter(k => k === 'EXDATE' || k.startsWith('EXDATE;')).forEach(k => {
          props[k].split(',').forEach(v => {
            try { rset.exdate(parseICSDate(v.trim(), k).date) } catch { /* skip */ }
          })
        })
        const occurrences = rset.between(startParsed.date, windowEnd, true)
        for (const occ of occurrences) {
          // Skip dates that have a RECURRENCE-ID override — the override VEVENT is emitted separately
          if (overrideDates.has(occ.toISOString())) continue
          events.push({
            id: `${uid}_${occ.toISOString()}`,
            title, source, location, description, attendees, organizer,
            start: toISO(occ, startParsed.allDay),
            end: toISO(new Date(occ.getTime() + duration), endParsed.allDay),
            allDay: startParsed.allDay,
          })
        }
      } catch {
        events.push({ id: uid, title, source, location, description, attendees, organizer,
          start: toISO(startParsed.date, startParsed.allDay),
          end: toISO(endParsed.date, endParsed.allDay),
          allDay: startParsed.allDay })
      }
    } else {
      events.push({ id: uid, title, source, location, description, attendees, organizer,
        start: toISO(startParsed.date, startParsed.allDay),
        end: toISO(endParsed.date, endParsed.allDay),
        allDay: startParsed.allDay })
    }
  }

  return events.sort((a, b) => a.start.localeCompare(b.start))
}

/** Read cached events for a given source. Returns empty cache on miss. */
export async function readCache(source: 'travel' | 'personal'): Promise<Cache> {
  try {
    const raw = await readFile(join(cacheDir(), `${source}.json`), 'utf-8')
    return JSON.parse(raw) as Cache
  } catch {
    return { fetchedAt: '', events: [] }
  }
}

/** Write events to cache for a given source. */
export async function writeCache(source: 'travel' | 'personal', events: CalendarEvent[]): Promise<void> {
  await mkdir(cacheDir(), { recursive: true })
  await writeFile(
    join(cacheDir(), `${source}.json`),
    JSON.stringify({ fetchedAt: new Date().toISOString(), events }, null, 2)
  )
}

/**
 * Read all cached events, optionally filtered by date range (YYYY-MM-DD strings).
 * An event is included if its date range overlaps [start, end].
 */
export async function getCalendarEvents(opts: { start?: string; end?: string } = {}): Promise<{
  events: CalendarEvent[]
  fetchedAt: { travel: string; personal: string }
}> {
  const [travelCache, personalCache] = await Promise.all([
    readCache('travel'),
    readCache('personal'),
  ])

  let events = [...travelCache.events, ...personalCache.events]

  if (opts.start || opts.end) {
    events = events.filter(e => {
      const eStart = e.start.slice(0, 10)
      const eEnd = e.end.slice(0, 10)
      if (opts.end && eStart > opts.end) return false
      if (opts.start && eEnd < opts.start) return false
      return true
    })
  }

  events.sort((a, b) => a.start.localeCompare(b.start))

  return {
    events,
    fetchedAt: { travel: travelCache.fetchedAt, personal: personalCache.fetchedAt },
  }
}
