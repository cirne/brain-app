/**
 * Calendar event shape and agent enrichment. Data comes from the ripmail index via {@link ./calendarRipmail.js}.
 */
export interface CalendarEvent {
  id: string
  title: string
  /** ISO date string: "YYYY-MM-DD" for all-day, "YYYY-MM-DDTHH:MM:SSZ" for timed */
  start: string
  /** ISO date string. For all-day events DTEND is exclusive (day after last day). */
  end: string
  allDay: boolean
  /** e.g. `googleCalendar`, `icsSubscription` — from ripmail `sourceKind` */
  source: string
  /** e.g. the specific Gmail calendar email address */
  calendarId?: string
  location?: string
  description?: string
  attendees?: string[]
  organizer?: string
  color?: string
}

/** Weekday name (e.g. "Monday") for a UTC calendar date YYYY-MM-DD. */
export function weekdayLongForUtcYmd(yyyyMmDd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.slice(0, 10))
  if (!m) return ''
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0))
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(dt)
}

function utcYmdAddDays(yyyyMmDd: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.slice(0, 10))
  if (!m) return ''
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0))
  dt.setUTCDate(dt.getUTCDate() + deltaDays)
  return dt.toISOString().slice(0, 10)
}

const DESCRIPTION_MAX = 200

/**
 * Compact agent-facing event format. Strips noisy fields (long IDs, hash organizers, source)
 * and truncates long descriptions so the LLM result stays well within the 4 KB SSE limit.
 *
 * The `id` field is kept (short form) because the agent may reference it for the `open` tool.
 * `startDayOfWeek` is included so the model doesn't have to derive it from UTC ISO strings.
 * For all-day events, ICS `end` is exclusive; `endDayOfWeek` reflects the last inclusive day.
 */
export function enrichCalendarEventsForAgent(events: CalendarEvent[]): Record<string, unknown>[] {
  return events.map(e => {
    const startYmd = e.start.slice(0, 10)
    const endYmd = e.end.slice(0, 10)
    const endForWeekday = e.allDay ? utcYmdAddDays(endYmd, -1) : endYmd

    // Strip hash organizers (long opaque strings from Google group calendars) — keep real emails
    const organizer =
      e.organizer && /^[^@]+@[^@]+$/.test(e.organizer) && !e.organizer.includes('group.calendar.google')
        ? e.organizer
        : undefined

    // Truncate description — Zoom meeting bodies can be thousands of chars
    const description =
      e.description && e.description.length > DESCRIPTION_MAX
        ? e.description.slice(0, DESCRIPTION_MAX) + '…'
        : e.description

    const row: Record<string, unknown> = {
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      source: e.source,
      calendarId: e.calendarId,
      startDayOfWeek: weekdayLongForUtcYmd(startYmd),
      endDayOfWeek: weekdayLongForUtcYmd(endForWeekday),
    }
    if (e.allDay) row.allDay = true
    if (e.location) row.location = e.location
    if (description) row.description = description
    if (e.attendees?.length) row.attendees = e.attendees
    if (organizer) row.organizer = organizer
    if (e.color) row.color = e.color
    return row
  })
}

export async function getCalendarEvents(opts: {
  start?: string
  end?: string
  calendarIds?: string[]
} = {}): Promise<{
  events: CalendarEvent[]
  fetchedAt: { ripmail: string }
  sourcesConfigured: boolean
  availableCalendars?: { id: string; name?: string; sourceId: string }[]
}> {
  const { getCalendarEventsFromRipmail } = await import('@server/lib/calendar/calendarRipmail.js')
  const rip = await getCalendarEventsFromRipmail(opts)
  return {
    events: rip.events,
    fetchedAt: { ripmail: rip.meta.ripmail },
    sourcesConfigured: rip.meta.sourcesConfigured,
    availableCalendars: rip.meta.availableCalendars,
  }
}
