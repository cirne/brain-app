import { describe, expect, it } from 'vitest'
import { shouldRetryProfilingAutoAdvance } from './profilingAutoAdvanceRetry.js'

describe('shouldRetryProfilingAutoAdvance', () => {
  it('allows attempt when there was no prior failure', () => {
    expect(shouldRetryProfilingAutoAdvance(500, null)).toBe(true)
  })

  it('blocks retry at the same indexed count after a failure', () => {
    expect(shouldRetryProfilingAutoAdvance(1000, 1000)).toBe(false)
    expect(shouldRetryProfilingAutoAdvance(200, 200)).toBe(false)
  })

  it('allows retry when indexed count increased after failure', () => {
    expect(shouldRetryProfilingAutoAdvance(1001, 1000)).toBe(true)
    expect(shouldRetryProfilingAutoAdvance(201, 200)).toBe(true)
  })
})
