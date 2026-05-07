import { getContext } from 'svelte'
import type { SlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'

/** SlideOver sets this; Calendar claims and updates week nav controls. */
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

export type CalendarSlideHeaderCell = SlideHeaderCell<CalendarSlideHeaderState>

export function getCalendarSlideHeaderCell(): CalendarSlideHeaderCell | undefined {
  return getContext<CalendarSlideHeaderCell | undefined>(CALENDAR_SLIDE_HEADER)
}
