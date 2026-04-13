import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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

/** Parse an ICS datetime value + its property key into an ISO string. */
function parseDateTime(value: string, propKey: string): { iso: string; allDay: boolean } {
  const allDay = propKey.includes('VALUE=DATE') || value.length === 8

  if (allDay) {
    return {
      iso: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
      allDay: true,
    }
  }

  // DATETIME: YYYYMMDDTHHmmss[Z]
  const clean = value.endsWith('Z') ? value.slice(0, -1) : value
  const iso = `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T` +
    `${clean.slice(9, 11)}:${clean.slice(11, 13)}:${clean.slice(13, 15)}Z`
  return { iso, allDay: false }
}

function unescapeICS(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

/** Parse an ICS text blob into CalendarEvent objects. */
export function parseICS(icsText: string, source: 'travel' | 'personal'): CalendarEvent[] {
  const lines = unfold(icsText).split(/\r?\n/)
  const events: CalendarEvent[] = []
  let inEvent = false
  let current: Record<string, string> = {}

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true
      current = {}
      continue
    }

    if (line === 'END:VEVENT') {
      inEvent = false

      const dtStartKey = Object.keys(current).find(k => k === 'DTSTART' || k.startsWith('DTSTART;'))
      if (!dtStartKey) continue

      const dtEndKey = Object.keys(current).find(k => k === 'DTEND' || k.startsWith('DTEND;'))
      const startStr = current[dtStartKey]
      const endStr = dtEndKey ? current[dtEndKey] : startStr

      const startParsed = parseDateTime(startStr, dtStartKey)
      const endParsed = parseDateTime(endStr, dtEndKey ?? dtStartKey)

      events.push({
        id: current['UID'] ?? crypto.randomUUID(),
        title: unescapeICS(current['SUMMARY'] ?? '(No title)'),
        start: startParsed.iso,
        end: endParsed.iso,
        allDay: startParsed.allDay,
        source,
        location: current['LOCATION'] ? unescapeICS(current['LOCATION']) : undefined,
        description: current['DESCRIPTION']
          ? unescapeICS(current['DESCRIPTION']).slice(0, 500)
          : undefined,
      })
      continue
    }

    if (!inEvent) continue

    // ICS property: PROPNAME;PARAMS:VALUE — split on first colon only
    const colonIdx = line.indexOf(':')
    if (colonIdx < 0) continue

    const key = line.slice(0, colonIdx)
    const value = line.slice(colonIdx + 1)
    current[key] = value
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
