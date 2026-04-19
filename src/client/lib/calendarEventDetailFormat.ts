/** Shape from /api/calendar and DayEvents (ICS-backed). */
export type CalendarEventDetail = {
  title: string
  start: string
  end: string
  allDay: boolean
  source: string
  location?: string
  description?: string
}

/** Format ICS-backed event for the detail panel (local timezone for timed). */
export function formatCalendarEventWhen(e: CalendarEventDetail): string {
  if (e.allDay) {
    const start = e.start.slice(0, 10)
    const endEx = e.end.slice(0, 10)
    const endIncl = addDaysYMD(endEx, -1)
    if (start === endIncl) {
      return `${formatWeekdayYMD(start)} (all day)`
    }
    return `${formatWeekdayYMD(start)} – ${formatWeekdayYMD(endIncl)} (all day)`
  }
  const s = new Date(e.start)
  const en = new Date(e.end)
  const sameDay = s.toDateString() === en.toDateString()
  const datePart = s.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const t1 = s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  const t2 = en.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (sameDay) return `${datePart} · ${t1} – ${t2}`
  return `${datePart} ${t1} → ${en.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`
}

function formatWeekdayYMD(ymd: string): string {
  const d = new Date(ymd + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

/** DTEND is exclusive; convert to last inclusive calendar day as YYYY-MM-DD. */
function addDaysYMD(ymd: string, delta: number): string {
  const d = new Date(ymd + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function calendarSourceLabel(source: CalendarEventDetail['source']): string {
  return source === 'travel' ? 'Travel' : 'Personal'
}
