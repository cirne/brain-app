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

/**
 * Agent-facing event rows with explicit weekdays so the model does not infer them from ISO strings.
 * For all-day events, ICS `end` is exclusive; `endDayOfWeek` is the last inclusive calendar day.
 */
export function enrichCalendarEventsForAgent(
  events: CalendarEvent[],
): Array<CalendarEvent & { startDayOfWeek: string; endDayOfWeek: string }> {
  return events.map(e => {
    const startYmd = e.start.slice(0, 10)
    const endYmd = e.end.slice(0, 10)
    const endForWeekday = e.allDay ? utcYmdAddDays(endYmd, -1) : endYmd
    return {
      ...e,
      startDayOfWeek: weekdayLongForUtcYmd(startYmd),
      endDayOfWeek: weekdayLongForUtcYmd(endForWeekday),
    }
  })
}

export async function getCalendarEvents(opts: { start?: string; end?: string } = {}): Promise<{
  events: CalendarEvent[]
  fetchedAt: { ripmail: string }
  sourcesConfigured: boolean
}> {
  const { getCalendarEventsFromRipmail } = await import('./calendarRipmail.js')
  const rip = await getCalendarEventsFromRipmail(opts)
  return {
    events: rip.events,
    fetchedAt: { ripmail: rip.meta.ripmail },
    sourcesConfigured: rip.meta.sourcesConfigured,
  }
}
