import { describe, it, expect, vi, beforeEach } from 'vitest'
import CalendarDatePopover from './CalendarDatePopover.svelte'
import { render, screen, waitFor } from '@client/test/render.js'

describe('CalendarDatePopover.svelte', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ events: [] }),
      } as Response
    }) as typeof fetch
  })

  it('renders as a tooltip and wires hover keep/close handlers', async () => {
    const onKeep = vi.fn()
    const onStartClose = vi.fn()

    render(CalendarDatePopover, {
      props: {
        date: '2099-06-20',
        x: 12,
        y: 34,
        onKeep,
        onStartClose,
      },
    })

    const tip = screen.getByRole('tooltip')
    expect(tip).toBeInTheDocument()
    expect(tip).toHaveStyle({ left: '12px', top: '34px' })

    tip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    tip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
    expect(onKeep).toHaveBeenCalled()
    expect(onStartClose).toHaveBeenCalled()

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled()
    })
  })
})
