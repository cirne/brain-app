import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@client/test/render.js'
import CalendarPicker from './CalendarPicker.svelte'

describe('CalendarPicker.svelte', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads calendars, tints rows with colors, and shows sync markers', async () => {
    const load = vi.fn().mockResolvedValue({
      allCalendars: [
        { id: 'c1', name: 'Alpha', color: '#ff0000' },
        { id: 'c2', name: 'Beta', color: '#008800' },
      ],
      configuredIds: ['c1'],
    })
    const save = vi.fn().mockResolvedValue(undefined)

    render(CalendarPicker, {
      props: {
        reloadKey: 'hub-src',
        load,
        save,
        fallbackConfiguredIds: ['c1'],
      },
    })

    await waitFor(() => {
      expect(load).toHaveBeenCalled()
      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Beta')).toBeInTheDocument()
    })

    const alphaInput = screen.getByRole('checkbox', { name: /Alpha/i })
    const alphaLi = alphaInput.closest('.cal-picker-li')
    expect(alphaLi?.querySelector('.cal-picker-row--tinted')).toBeTruthy()
    expect(alphaLi?.querySelector('.cal-picker-row--tinted')?.getAttribute('style')).toMatch(
      /--cal-picker-accent:\s*#ff0000/i,
    )

    expect(document.querySelectorAll('.cal-picker-marker--on')).toHaveLength(1)
    expect(document.querySelectorAll('.cal-picker-marker--off')).toHaveLength(1)
  })

  it('calls save automatically when toggling a calendar', async () => {
    const load = vi.fn().mockResolvedValue({
      allCalendars: [
        { id: 'c1', name: 'One', color: '#111' },
        { id: 'c2', name: 'Two', color: '#222' },
      ],
      configuredIds: ['c1'],
    })
    const save = vi.fn().mockResolvedValue(undefined)

    const { container } = render(CalendarPicker, {
      props: {
        reloadKey: 'x',
        load,
        save,
      },
    })

    await waitFor(() => expect(screen.getByText('Two')).toBeInTheDocument())

    screen.getByRole('checkbox', { name: /Two/i }).click()

    await waitFor(() => expect(save).toHaveBeenCalled())
    const ids = save.mock.calls[0]?.[0] as string[]
    expect(ids).toHaveLength(2)
    expect(ids).toEqual(expect.arrayContaining(['c1', 'c2']))
    expect(container.querySelector('.cal-picker-saved')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Save$/i })).not.toBeInTheDocument()
  })

  it('lists calendars sorted alphabetically by display name', async () => {
    const load = vi.fn().mockResolvedValue({
      allCalendars: [
        { id: 'id-z', name: 'Zebra Cal', color: '#111' },
        { id: 'id-a', name: 'Apple Cal', color: '#222' },
        { id: 'id-m', name: 'Mango Cal', color: '#333' },
      ],
      configuredIds: ['id-z'],
    })
    const save = vi.fn().mockResolvedValue(undefined)

    render(CalendarPicker, {
      props: {
        reloadKey: 'sort-test',
        load,
        save,
      },
    })

    await waitFor(() => expect(screen.getByText('Apple Cal')).toBeInTheDocument())

    const names = [...document.querySelectorAll('.cal-picker-name')].map((el) => el.textContent)
    expect(names).toEqual(['Apple Cal', 'Mango Cal', 'Zebra Cal'])
  })
})
