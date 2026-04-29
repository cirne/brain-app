import { describe, it, expect } from 'vitest'
import { isTranscribeHttpAllowed } from './transcribeHttpAllowed.js'

describe('isTranscribeHttpAllowed', () => {
  it('is true including when NODE_ENV is production (revert: false in production)', () => {
    expect(isTranscribeHttpAllowed('production')).toBe(true)
    expect(isTranscribeHttpAllowed('development')).toBe(true)
    expect(isTranscribeHttpAllowed('test')).toBe(true)
    expect(isTranscribeHttpAllowed(undefined)).toBe(true)
  })
})
