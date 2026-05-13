import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ONBOARDING_DEFAULT_CHAT_STORAGE_KEY,
  ONBOARDING_PROFILE_CHAT_STORAGE_KEY,
  ONBOARDING_SEED_CHAT_STORAGE_KEY,
} from './onboarding/onboardingStorageKeys.js'
import {
  clearBrainClientStorage,
  clearOriginStorageDevReset,
} from './brainClientStorage.js'
import { FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY } from './onboarding/seedConstants.js'

function makeStore() {
  const store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
  } as Storage
}

describe('clearBrainClientStorage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStore())
    vi.stubGlobal('sessionStorage', makeStore())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('removes all brain- prefixed localStorage keys including main chat', () => {
    globalThis.localStorage.setItem(ONBOARDING_DEFAULT_CHAT_STORAGE_KEY, '{}')
    globalThis.localStorage.setItem(ONBOARDING_PROFILE_CHAT_STORAGE_KEY, '{}')
    globalThis.localStorage.setItem(ONBOARDING_SEED_CHAT_STORAGE_KEY, '{}')
    globalThis.localStorage.setItem('brain-agent', '{}')
    globalThis.localStorage.setItem('other-app', 'keep')
    clearBrainClientStorage()
    expect(globalThis.localStorage.getItem(ONBOARDING_DEFAULT_CHAT_STORAGE_KEY)).toBeNull()
    expect(globalThis.localStorage.getItem('brain-agent')).toBeNull()
    expect(globalThis.localStorage.getItem('other-app')).toBe('keep')
  })

  it('removes brain- prefixed sessionStorage keys', () => {
    globalThis.sessionStorage.setItem(FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY, '1')
    globalThis.sessionStorage.setItem('brain-temp', 'x')
    clearBrainClientStorage()
    expect(globalThis.sessionStorage.getItem(FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY)).toBeNull()
    expect(globalThis.sessionStorage.getItem('brain-temp')).toBeNull()
  })
})

describe('clearOriginStorageDevReset', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStore())
    vi.stubGlobal('sessionStorage', makeStore())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears all localStorage keys including brain. dot prefix', () => {
    globalThis.localStorage.setItem('brain.chat.toolDisplay', 'detailed')
    globalThis.localStorage.setItem('brain-agent', '{}')
    globalThis.localStorage.setItem('other-app', 'gone')
    clearOriginStorageDevReset()
    expect(globalThis.localStorage.length).toBe(0)
  })

  it('clears all sessionStorage keys', () => {
    globalThis.sessionStorage.setItem('anything', 'x')
    clearOriginStorageDevReset()
    expect(globalThis.sessionStorage.length).toBe(0)
  })
})
