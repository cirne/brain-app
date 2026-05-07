import { describe, it, expect, vi, afterEach } from 'vitest'
import Calendar from './Calendar.svelte'
import { render, waitFor } from '@client/test/render.js'
import {
  CALENDAR_SLIDE_HEADER,
  type CalendarSlideHeaderCell,
  type CalendarSlideHeaderState,
} from '@client/lib/calendarSlideHeaderContext.js'
import { makeSlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'

function emptyCalendarFetch(): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    if (u.includes('/api/calendar')) {
      return new Response(
        JSON.stringify({ events: [], fetchedAt: { ripmail: '' }, sourcesConfigured: false }),
        { status: 200 },
      )
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

describe('Calendar.svelte slide header cell (BUG-047)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('claims the calendar header cell once with stable nav handlers and patches scalars', async () => {
    vi.stubGlobal('fetch', emptyCalendarFetch())

    const cell: CalendarSlideHeaderCell = makeSlideHeaderCell<CalendarSlideHeaderState>()
    const context = new Map<symbol, CalendarSlideHeaderCell>([[CALENDAR_SLIDE_HEADER, cell]])

    const onContextChange = vi.fn()
    const { rerender } = render(Calendar, {
      props: { onContextChange },
      context,
    } as unknown as Parameters<typeof render>[1])

    await waitFor(() => {
      expect(cell.claimed).toBe(true)
    })

    const prevWeekRef = cell.current?.prevWeek
    const nextWeekRef = cell.current?.nextWeek
    const goTodayRef = cell.current?.goToday
    const refreshRef = cell.current?.refreshCalendars

    expect(typeof prevWeekRef).toBe('function')
    expect(typeof refreshRef).toBe('function')
    expect(typeof cell.current?.weekLabel).toBe('string')

    // Re-render with a brand new `onContextChange` callback prop. Because we publish via
    // `untrack`, this must not cause the header effect to thrash, and the handler refs in
    // the cell must remain identical.
    const onContextChange2 = vi.fn()
    rerender({ onContextChange: onContextChange2 })

    await waitFor(() => {
      expect(cell.claimed).toBe(true)
    })
    expect(cell.current?.prevWeek).toBe(prevWeekRef)
    expect(cell.current?.nextWeek).toBe(nextWeekRef)
    expect(cell.current?.goToday).toBe(goTodayRef)
    expect(cell.current?.refreshCalendars).toBe(refreshRef)
  })
})
