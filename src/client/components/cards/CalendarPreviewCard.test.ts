import { describe, it, expect, vi } from 'vitest'
import CalendarPreviewCard from './CalendarPreviewCard.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('CalendarPreviewCard.svelte', () => {
  it('shows empty range copy when there are no events', () => {
    render(CalendarPreviewCard, {
      props: {
        start: '2099-01-01',
        end: '2099-01-03',
        events: [],
      },
    })
    expect(screen.getByText(/calendar/i)).toBeInTheDocument()
    expect(screen.getByText(/no events in this range/i)).toBeInTheDocument()
  })

  it('calls onOpenCalendar with the range start from the footer button', async () => {
    const onOpenCalendar = vi.fn()
    render(CalendarPreviewCard, {
      props: {
        start: '2099-02-01',
        end: '2099-02-01',
        events: [],
        onOpenCalendar,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /open calendar/i }))
    expect(onOpenCalendar).toHaveBeenCalledWith('2099-02-01')
  })
})
