import { describe, expect, it, vi } from 'vitest'
import {
  getWikiSupervisorClock,
  resetWikiSupervisorClockForTests,
  setWikiSupervisorClockForTests,
} from './yourWikiSupervisorClock.js'

describe('yourWikiSupervisorClock', () => {
  it('defaults to global timers', () => {
    resetWikiSupervisorClockForTests()
    const c = getWikiSupervisorClock()
    expect(typeof c.setTimeout).toBe('function')
    expect(typeof c.clearTimeout).toBe('function')
    const id = c.setTimeout(() => {}, 5)
    expect(id).toBeDefined()
    c.clearTimeout(id)
  })

  it('accepts test override', () => {
    const st = vi.fn(globalThis.setTimeout) as unknown as typeof globalThis.setTimeout
    const ct = vi.fn(globalThis.clearTimeout) as unknown as typeof globalThis.clearTimeout
    setWikiSupervisorClockForTests({ setTimeout: st, clearTimeout: ct })
    expect(getWikiSupervisorClock().setTimeout).toBe(st)
    resetWikiSupervisorClockForTests()
  })
})
