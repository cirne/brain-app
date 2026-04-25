import { describe, it, expect } from 'vitest'
import { pressToTalkEnabledFromMetaEnv } from './pressToTalkEnabled.js'

describe('pressToTalkEnabledFromMetaEnv', () => {
  it('is true only when DEV is true', () => {
    expect(pressToTalkEnabledFromMetaEnv({ DEV: true })).toBe(true)
    expect(pressToTalkEnabledFromMetaEnv({ DEV: false })).toBe(false)
  })
})
