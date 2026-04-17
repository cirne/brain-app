import { describe, it, expect } from 'vitest'
import { shiftQueuedFollowUp } from './agentFollowUpQueue.js'

describe('shiftQueuedFollowUp (OPP-016)', () => {
  it('returns null when queue is empty or missing', () => {
    expect(shiftQueuedFollowUp(null)).toEqual({ next: null, rest: [] })
    expect(shiftQueuedFollowUp(undefined)).toEqual({ next: null, rest: [] })
    expect(shiftQueuedFollowUp([])).toEqual({ next: null, rest: [] })
  })

  it('skips blank entries', () => {
    expect(shiftQueuedFollowUp(['', '  ', 'hello'])).toEqual({ next: 'hello', rest: [] })
  })

  it('returns first message and keeps the rest', () => {
    expect(shiftQueuedFollowUp(['a', 'b'])).toEqual({ next: 'a', rest: ['b'] })
  })

  it('trims the popped message', () => {
    expect(shiftQueuedFollowUp(['  x  '])).toEqual({ next: 'x', rest: [] })
  })
})
