import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ONBOARDING_DEFAULT_CHAT_STORAGE_KEY,
  ONBOARDING_PROFILE_CHAT_STORAGE_KEY,
  ONBOARDING_SEED_CHAT_STORAGE_KEY,
  clearOnboardingAgentLocalStorage,
} from './onboardingStorageKeys.js'

describe('clearOnboardingAgentLocalStorage', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    const ls = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => {
        delete store[k]
      },
    } as Storage
    vi.stubGlobal('localStorage', ls)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('removes all onboarding agent transcript keys', () => {
    globalThis.localStorage.setItem(ONBOARDING_DEFAULT_CHAT_STORAGE_KEY, '{}')
    globalThis.localStorage.setItem(ONBOARDING_PROFILE_CHAT_STORAGE_KEY, '{}')
    globalThis.localStorage.setItem(ONBOARDING_SEED_CHAT_STORAGE_KEY, '{}')
    clearOnboardingAgentLocalStorage()
    expect(globalThis.localStorage.getItem(ONBOARDING_DEFAULT_CHAT_STORAGE_KEY)).toBeNull()
    expect(globalThis.localStorage.getItem(ONBOARDING_PROFILE_CHAT_STORAGE_KEY)).toBeNull()
    expect(globalThis.localStorage.getItem(ONBOARDING_SEED_CHAT_STORAGE_KEY)).toBeNull()
  })
})
