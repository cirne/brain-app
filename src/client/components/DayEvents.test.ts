import { describe, it, expect, vi } from 'vitest'
import DayEvents from './DayEvents.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

type CalendarEvent = {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  source: string
}

describe('DayEvents.svelte', () => {
  const date = '2099-06-15'

  it('renders timed events from props without fetching', async () => {
    const onEventOpen = vi.fn()
    const ev: CalendarEvent = {
      id: 't1',
      title: 'Timed meeting',
      start: `${date}T10:00:00`,
      end: `${date}T11:00:00`,
      allDay: false,
      source: 'test',
    }

    render(DayEvents, {
      props: { date, events: [ev], onEventOpen },
    })

    expect(screen.getByText('Timed meeting')).toBeInTheDocument()

    await fireEvent.click(
      screen.getByRole('button', { name: /open timed meeting in calendar/i }),
    )
    expect(onEventOpen).toHaveBeenCalledWith(ev)
  })

  it('renders all-day events and uses onEventSelect when onEventOpen is absent', async () => {
    const onEventSelect = vi.fn()
    const ev: CalendarEvent = {
      id: 'a1',
      title: 'Away',
      start: '2099-06-14',
      end: '2099-06-17',
      allDay: true,
      source: 'test',
    }

    render(DayEvents, {
      props: { date, events: [ev], onEventSelect },
    })

    await fireEvent.click(screen.getByRole('button', { name: /view details: away/i }))
    expect(onEventSelect).toHaveBeenCalledWith(ev)
  })
})
