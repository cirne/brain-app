import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  clearNavHistory,
  loadNavHistory,
  makeNavHistoryId,
  upsertEmailNavHistory,
} from './navHistory.js'

describe('navHistory', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    const ls = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    } as Storage
    vi.stubGlobal('localStorage', ls)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('upsertEmailNavHistory skips loading placeholder', () => {
    expect(upsertEmailNavHistory('t1', '(loading)', '')).toBe(false)
    expect(loadNavHistory()).toEqual([])
  })

  it('upsertEmailNavHistory adds new email with subject', () => {
    expect(upsertEmailNavHistory('abc', 'Hello world', 'a@b.c')).toBe(true)
    const h = loadNavHistory()
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({
      id: makeNavHistoryId('email', 'abc'),
      type: 'email',
      title: 'Hello world',
      path: 'abc',
      meta: 'a@b.c',
    })
  })

  it('upsertEmailNavHistory updates title in place for existing entry', () => {
    expect(upsertEmailNavHistory('x', 'First subject', 'from@x')).toBe(true)
    expect(upsertEmailNavHistory('x', 'Second subject', 'from@x')).toBe(true)
    const h = loadNavHistory()
    expect(h).toHaveLength(1)
    expect(h[0].title).toBe('Second subject')
  })

  it('upsertEmailNavHistory returns false when nothing changed', () => {
    expect(upsertEmailNavHistory('y', 'Same', 'f@x')).toBe(true)
    expect(upsertEmailNavHistory('y', 'Same', 'f@x')).toBe(false)
  })

  it('clearNavHistory empties storage', () => {
    upsertEmailNavHistory('z', 'Z subj', '')
    expect(loadNavHistory().length).toBe(1)
    clearNavHistory()
    expect(loadNavHistory()).toEqual([])
  })
})
