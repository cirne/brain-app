import { describe, it, expect } from 'vitest'
import { pressToTalkEnabledFromMetaEnv } from './pressToTalkEnabled.js'

describe('pressToTalkEnabledFromMetaEnv', () => {
  it('is hardcoded off (restore env/DEV gating when shipping)', () => {
    expect(pressToTalkEnabledFromMetaEnv({ DEV: true })).toBe(false)
    expect(pressToTalkEnabledFromMetaEnv({ DEV: false })).toBe(false)
  })
})
