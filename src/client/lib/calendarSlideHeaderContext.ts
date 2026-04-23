/** SlideOver sets this; Calendar registers week nav controls for the L2 header. */
export const CALENDAR_SLIDE_HEADER = Symbol('calendarSlideHeader')

export type CalendarSlideHeaderState = {
  weekLabel: string
  prevWeek: () => void
  nextWeek: () => void
  goToday: () => void
  /** Re-fetch calendar index for configured calendar sources (no full mail sync). */
  refreshCalendars: () => void
  /** True while events are loading or a calendar refresh is in progress. */
  headerBusy: boolean
}

export type SetCalendarSlideHeader = (_state: CalendarSlideHeaderState | null) => void
