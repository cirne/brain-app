import { describe, it, expect, vi } from 'vitest'
import { emit, subscribe } from './appEvents.js'

describe('appEvents', () => {
  it('delivers emitted events to subscribers', () => {
    const received: string[] = []
    const unsub = subscribe((e) => {
      if (e.type === 'wiki:mutated') received.push(`wiki:${e.source}`)
    })
    emit({ type: 'wiki:mutated', source: 'agent' })
    expect(received).toEqual(['wiki:agent'])
    unsub()
  })

  it('notifies multiple subscribers in subscription order', () => {
    const order: number[] = []
    const u1 = subscribe(() => order.push(1))
    const u2 = subscribe(() => order.push(2))
    emit({ type: 'sync:completed' })
    expect(order).toEqual([1, 2])
    u1()
    u2()
  })

  it('stops delivering after unsubscribe', () => {
    const fn = vi.fn()
    const unsub = subscribe(fn)
    emit({ type: 'sync:completed' })
    expect(fn).toHaveBeenCalledTimes(1)
    unsub()
    emit({ type: 'sync:completed' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not break other listeners when one throws', () => {
    const good = vi.fn()
    const u1 = subscribe(() => {
      throw new Error('boom')
    })
    const u2 = subscribe(good)
    emit({ type: 'wiki:mutated', source: 'agent' })
    expect(good).toHaveBeenCalledTimes(1)
    u1()
    u2()
  })
})
