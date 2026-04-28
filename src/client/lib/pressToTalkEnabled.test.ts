import { describe, it, expect } from 'vitest'
import { pressToTalkEnabledFromMetaEnv } from './pressToTalkEnabled.js'

describe('pressToTalkEnabledFromMetaEnv', () => {
  it('enables in dev and disables in production build', () => {
    expect(pressToTalkEnabledFromMetaEnv({ DEV: true })).toBe(true)
    expect(pressToTalkEnabledFromMetaEnv({ DEV: false })).toBe(false)
  })
})
