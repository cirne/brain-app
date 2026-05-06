import { describe, expect, it } from 'vitest'
import {
  isOnboardingStatusPublicPath,
  isVaultPublicRoute,
  shouldSuppressAccessLogForApiPath,
} from './publicRoutePolicy.js'
import { ENRON_DEMO_SEED_STATUS_PATH } from './enronDemo.js'

describe('publicRoutePolicy', () => {
  it('identifies onboarding status GET', () => {
    expect(isOnboardingStatusPublicPath('/api/onboarding/status', 'GET')).toBe(true)
    expect(isOnboardingStatusPublicPath('/api/onboarding/status', 'POST')).toBe(false)
  })

  it('identifies vault public routes', () => {
    expect(isVaultPublicRoute('/api/vault/status', 'GET')).toBe(true)
    expect(isVaultPublicRoute('/api/vault/status', 'POST')).toBe(true)
    expect(isVaultPublicRoute('/api/vault/logout', 'POST')).toBe(true)
    expect(isVaultPublicRoute('/api/vault/setup', 'GET')).toBe(false)
  })

  it('suppresses access logs for poll endpoints', () => {
    expect(shouldSuppressAccessLogForApiPath('/api/onboarding/mail')).toBe(true)
    expect(shouldSuppressAccessLogForApiPath(ENRON_DEMO_SEED_STATUS_PATH)).toBe(true)
    expect(shouldSuppressAccessLogForApiPath('/api/chat')).toBe(false)
  })
})
