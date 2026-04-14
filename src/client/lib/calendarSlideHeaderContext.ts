/** SlideOver sets this; Calendar registers week nav controls for the L2 header. */
export const CALENDAR_SLIDE_HEADER = Symbol('calendarSlideHeader')

export type CalendarSlideHeaderState = {
  weekLabel: string
  prevWeek: () => void
  nextWeek: () => void
  goToday: () => void
}

export type SetCalendarSlideHeader = (_state: CalendarSlideHeaderState | null) => void
