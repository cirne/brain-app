import { describe, it, expect } from 'vitest'
import { createAsyncLatest, isAbortError } from './asyncLatest.js'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('createAsyncLatest', () => {
  it('marks previous token stale after begin', () => {
    const latest = createAsyncLatest()
    const a = latest.begin()
    expect(latest.isStale(a.token)).toBe(false)
    const b = latest.begin()
    expect(latest.isStale(a.token)).toBe(true)
    expect(latest.isStale(b.token)).toBe(false)
  })

  it('with abortPrevious, second begin aborts prior signal', () => {
    const latest = createAsyncLatest({ abortPrevious: true })
    const { signal: s1 } = latest.begin()
    expect(s1.aborted).toBe(false)
    latest.begin()
    expect(s1.aborted).toBe(true)
  })

  it('without abortPrevious, prior signal is not aborted', () => {
    const latest = createAsyncLatest()
    const { signal: s1 } = latest.begin()
    latest.begin()
    expect(s1.aborted).toBe(false)
  })

  it('only latest async completion should commit (simulated)', async () => {
    const latest = createAsyncLatest()
    const commits: string[] = []

    const { token: t1 } = latest.begin()
    const p1 = delay(30).then(() => {
      if (!latest.isStale(t1)) commits.push('first')
    })

    const { token: t2 } = latest.begin()
    const p2 = delay(10).then(() => {
      if (!latest.isStale(t2)) commits.push('second')
    })

    await Promise.all([p1, p2])
    expect(commits).toEqual(['second'])
  })
})

describe('isAbortError', () => {
  it('detects DOMException AbortError', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
  })

  it('detects Error AbortError', () => {
    const e = new Error('aborted')
    e.name = 'AbortError'
    expect(isAbortError(e)).toBe(true)
  })

  it('returns false for other errors', () => {
    expect(isAbortError(new Error('nope'))).toBe(false)
  })
})
