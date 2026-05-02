/** One selectable calendar row (e.g. Google Calendar list-calendars JSON). */
export type CalendarPickerCalendar = {
  id: string
  name: string
  color?: string
}

export type CalendarPickerLoadResult = {
  allCalendars: CalendarPickerCalendar[]
  configuredIds: string[]
}
