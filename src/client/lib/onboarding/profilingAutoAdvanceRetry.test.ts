import { describe, it, expect } from 'vitest'
import { shouldRetryProfilingAutoAdvance } from './profilingAutoAdvanceRetry.js'

describe('shouldRetryProfilingAutoAdvance', () => {
  it('allows first attempt and retries after indexed count increases', () => {
    expect(shouldRetryProfilingAutoAdvance(500, null)).toBe(true)
    expect(shouldRetryProfilingAutoAdvance(1000, 1000)).toBe(false)
    expect(shouldRetryProfilingAutoAdvance(200, 200)).toBe(false)
    expect(shouldRetryProfilingAutoAdvance(1001, 1000)).toBe(true)
    expect(shouldRetryProfilingAutoAdvance(201, 200)).toBe(true)
  })
})
