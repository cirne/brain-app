import { describe, it, expect } from 'vitest'
import { isTranscribeHttpAllowed } from './transcribeHttpAllowed.js'

describe('isTranscribeHttpAllowed', () => {
  it('is false when NODE_ENV is production', () => {
    expect(isTranscribeHttpAllowed('production')).toBe(false)
  })

  it('is true for development, test, and undefined', () => {
    expect(isTranscribeHttpAllowed('development')).toBe(true)
    expect(isTranscribeHttpAllowed('test')).toBe(true)
    expect(isTranscribeHttpAllowed(undefined)).toBe(true)
  })
})
