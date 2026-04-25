import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  clearGoogleOauthDesktopResultForTests,
  recordGoogleOauthError,
  recordGoogleOauthSuccess,
  takeGoogleOauthDesktopResult,
} from './googleOauthDesktopResult.js'

beforeEach(() => {
  clearGoogleOauthDesktopResultForTests()
})
afterEach(() => {
  clearGoogleOauthDesktopResultForTests()
  vi.useRealTimers()
})

describe('googleOauthDesktopResult', () => {
  it('returns done false when empty', () => {
    expect(takeGoogleOauthDesktopResult()).toEqual({ done: false })
  })

  it('take success clears and returns ok', () => {
    recordGoogleOauthSuccess()
    expect(takeGoogleOauthDesktopResult()).toEqual({ done: true, ok: true })
    expect(takeGoogleOauthDesktopResult()).toEqual({ done: false })
  })

  it('take error clears and returns message', () => {
    recordGoogleOauthError('bad')
    expect(takeGoogleOauthDesktopResult()).toEqual({
      done: true,
      ok: false,
      error: 'bad',
    })
    expect(takeGoogleOauthDesktopResult()).toEqual({ done: false })
  })

  it('expires after TTL', () => {
    vi.useFakeTimers()
    recordGoogleOauthSuccess()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    expect(takeGoogleOauthDesktopResult()).toEqual({ done: false })
  })
})
