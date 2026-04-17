import { describe, it, expect, vi } from 'vitest'
import { emit } from './app/appEvents.js'
import { registerWikiFileListRefetch } from './wikiFileListRefetch.js'

describe('registerWikiFileListRefetch (@-mention wiki list)', () => {
  it('refetches when wiki:mutated fires (agent or user save)', () => {
    const fetchList = vi.fn()
    const unsub = registerWikiFileListRefetch(fetchList)
    emit({ type: 'wiki:mutated', source: 'agent' })
    expect(fetchList).toHaveBeenCalledTimes(1)
    emit({ type: 'wiki:mutated', source: 'user' })
    expect(fetchList).toHaveBeenCalledTimes(2)
    unsub()
  })

  it('refetches on sync:completed', () => {
    const fetchList = vi.fn()
    const unsub = registerWikiFileListRefetch(fetchList)
    emit({ type: 'sync:completed' })
    expect(fetchList).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('stops refetching after unsubscribe', () => {
    const fetchList = vi.fn()
    const unsub = registerWikiFileListRefetch(fetchList)
    unsub()
    emit({ type: 'wiki:mutated', source: 'agent' })
    emit({ type: 'sync:completed' })
    expect(fetchList).not.toHaveBeenCalled()
  })
})
