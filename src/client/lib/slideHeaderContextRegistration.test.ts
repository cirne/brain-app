import { describe, expect, it, vi } from 'vitest'
import { makeSlideHeaderCell } from './slideHeaderContextRegistration.svelte.js'

type CalState = {
  weekLabel: string
  headerBusy: boolean
  prevWeek: () => void
}

describe('makeSlideHeaderCell', () => {
  it('starts unclaimed with `current === null`', () => {
    const cell = makeSlideHeaderCell<CalState>()
    expect(cell.current).toBeNull()
    expect(cell.claimed).toBe(false)
  })

  it('claim() exposes initial state and marks the cell claimed', () => {
    const cell = makeSlideHeaderCell<CalState>()
    const prevWeek = vi.fn()
    const ctrl = cell.claim({ weekLabel: 'Jan 1–7', headerBusy: false, prevWeek })
    expect(cell.claimed).toBe(true)
    expect(cell.current?.weekLabel).toBe('Jan 1–7')
    expect(ctrl.isOwner).toBe(true)
    expect(ctrl.state?.prevWeek).toBe(prevWeek)
  })

  it('patch updates only differing scalar fields', () => {
    const cell = makeSlideHeaderCell<CalState>()
    const prevWeek = vi.fn()
    const ctrl = cell.claim({ weekLabel: 'Jan 1–7', headerBusy: false, prevWeek })

    ctrl.patch({ headerBusy: true })
    expect(cell.current?.headerBusy).toBe(true)
    expect(cell.current?.weekLabel).toBe('Jan 1–7')
    expect(cell.current?.prevWeek).toBe(prevWeek)
  })

  it('patch with same scalar values is a no-op (no current reassignment)', () => {
    const cell = makeSlideHeaderCell<CalState>()
    const prevWeek = vi.fn()
    const ctrl = cell.claim({ weekLabel: 'Jan 1–7', headerBusy: false, prevWeek })

    const before = cell.current
    ctrl.patch({ headerBusy: false, weekLabel: 'Jan 1–7' })
    expect(cell.current).toBe(before)
  })

  it('clear releases the cell', () => {
    const cell = makeSlideHeaderCell<CalState>()
    const ctrl = cell.claim({ weekLabel: 'a', headerBusy: false, prevWeek: () => {} })

    ctrl.clear()
    expect(cell.current).toBeNull()
    expect(cell.claimed).toBe(false)
    expect(ctrl.isOwner).toBe(false)
    expect(ctrl.state).toBeNull()
  })

  it('replace swaps the entire payload for the active owner', () => {
    const cell = makeSlideHeaderCell<CalState>()
    const ctrl = cell.claim({ weekLabel: 'a', headerBusy: false, prevWeek: () => {} })

    const fresh: CalState = { weekLabel: 'b', headerBusy: true, prevWeek: () => {} }
    ctrl.replace(fresh)
    expect(cell.current?.weekLabel).toBe('b')
    expect(cell.current?.headerBusy).toBe(true)
  })

  it('a stale controller cannot clear or patch a cell re-claimed by a sibling', () => {
    const cell = makeSlideHeaderCell<CalState>()
    const stale = cell.claim({ weekLabel: 'old', headerBusy: false, prevWeek: () => {} })
    const fresh = cell.claim({ weekLabel: 'new', headerBusy: false, prevWeek: () => {} })

    expect(stale.isOwner).toBe(false)
    expect(stale.state).toBeNull()

    stale.patch({ headerBusy: true })
    expect(cell.current?.headerBusy).toBe(false)
    expect(cell.current?.weekLabel).toBe('new')

    stale.clear()
    expect(cell.claimed).toBe(true)
    expect(fresh.isOwner).toBe(true)
    expect(cell.current?.weekLabel).toBe('new')
  })

  it('patch on stale controller is a no-op even when fields exist on cell', () => {
    const cell = makeSlideHeaderCell<CalState>()
    const stale = cell.claim({ weekLabel: 'a', headerBusy: false, prevWeek: () => {} })
    cell.claim({ weekLabel: 'b', headerBusy: false, prevWeek: () => {} })

    stale.patch({ weekLabel: 'hijacked' })
    expect(cell.current?.weekLabel).toBe('b')
  })

  it('replace on stale controller is a no-op', () => {
    const cell = makeSlideHeaderCell<CalState>()
    const stale = cell.claim({ weekLabel: 'a', headerBusy: false, prevWeek: () => {} })
    cell.claim({ weekLabel: 'b', headerBusy: false, prevWeek: () => {} })

    stale.replace({ weekLabel: 'hijacked', headerBusy: true, prevWeek: () => {} })
    expect(cell.current?.weekLabel).toBe('b')
  })
})
