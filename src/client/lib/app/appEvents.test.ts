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

  it('sync:completed is used by inbox surfaces to refetch after full sync', () => {
    const reloadInbox = vi.fn()
    const unsub = subscribe((e) => {
      if (e.type === 'sync:completed') reloadInbox()
    })
    emit({ type: 'sync:completed' })
    expect(reloadInbox).toHaveBeenCalledTimes(1)
    unsub()
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

  it('delivers inbox:archived with messageId', () => {
    const ids: string[] = []
    const unsub = subscribe((e) => {
      if (e.type === 'inbox:archived') ids.push(e.messageId)
    })
    emit({ type: 'inbox:archived', messageId: 'msg-1' })
    expect(ids).toEqual(['msg-1'])
    unsub()
  })

  it('delivers chat:sessions-changed', () => {
    let n = 0
    const unsub = subscribe((e) => {
      if (e.type === 'chat:sessions-changed') n++
    })
    emit({ type: 'chat:sessions-changed' })
    expect(n).toBe(1)
    unsub()
  })

  it('delivers hub:sources-changed', () => {
    let n = 0
    const unsub = subscribe((e) => {
      if (e.type === 'hub:sources-changed') n++
    })
    emit({ type: 'hub:sources-changed' })
    expect(n).toBe(1)
    unsub()
  })

  it('delivers hub:devices-changed', () => {
    let n = 0
    const unsub = subscribe((e) => {
      if (e.type === 'hub:devices-changed') n++
    })
    emit({ type: 'hub:devices-changed' })
    expect(n).toBe(1)
    unsub()
  })
})
