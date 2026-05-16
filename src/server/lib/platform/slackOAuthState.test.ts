import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearSlackOAuthSessionsForTests,
  newSlackOAuthState,
  putSlackOAuthSession,
  takeSlackOAuthSession,
} from './slackOAuthState.js'

describe('slackOAuthState', () => {
  beforeEach(() => {
    clearSlackOAuthSessionsForTests()
  })

  it('stores and consumes state once', () => {
    const state = newSlackOAuthState()
    putSlackOAuthSession(state, 'usr_test', 'install')
    expect(takeSlackOAuthSession(state)).toEqual({ tenantUserId: 'usr_test', mode: 'install' })
    expect(takeSlackOAuthSession(state)).toBeNull()
  })

  it('preserves link vs install mode', () => {
    const state = newSlackOAuthState()
    putSlackOAuthSession(state, 'usr_x', 'link')
    expect(takeSlackOAuthSession(state)?.mode).toBe('link')
  })
})
