import { describe, it, expect } from 'vitest'
import { pressToTalkEnabledFromMetaEnv } from './pressToTalkEnabled.js'

describe('pressToTalkEnabledFromMetaEnv', () => {
  it('is enabled for dev and production builds (revert: gate on env.DEV)', () => {
    expect(pressToTalkEnabledFromMetaEnv({ DEV: true })).toBe(true)
    expect(pressToTalkEnabledFromMetaEnv({ DEV: false })).toBe(true)
  })
})
