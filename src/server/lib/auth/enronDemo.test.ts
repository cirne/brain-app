import { describe, it, expect, afterEach } from 'vitest'
import {
  ENRON_DEMO_MINT_PATH,
  ENRON_DEMO_RESEED_PATH,
  ENRON_DEMO_SEED_STATUS_PATH,
  ENRON_DEMO_USERS_PATH,
  enronDemoSecretConfigured,
  isEnronDemoMintPath,
  isEnronDemoPublicApiPath,
  isEnronDemoReseedPath,
  isEnronDemoSeedStatusPath,
  isEnronDemoUsersListPath,
} from './enronDemo.js'

describe('enronDemo', () => {
  const prevSecret = process.env.BRAIN_ENRON_DEMO_SECRET

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.BRAIN_ENRON_DEMO_SECRET
    else process.env.BRAIN_ENRON_DEMO_SECRET = prevSecret
  })

  it('isEnronDemoMintPath matches POST only', () => {
    expect(isEnronDemoMintPath(ENRON_DEMO_MINT_PATH, 'POST')).toBe(true)
    expect(isEnronDemoMintPath(`${ENRON_DEMO_MINT_PATH}/`, 'POST')).toBe(true)
    expect(isEnronDemoMintPath(ENRON_DEMO_MINT_PATH, 'GET')).toBe(false)
    expect(isEnronDemoMintPath('/api/other', 'POST')).toBe(false)
  })

  it('isEnronDemoSeedStatusPath matches GET only', () => {
    expect(isEnronDemoSeedStatusPath(ENRON_DEMO_SEED_STATUS_PATH, 'GET')).toBe(true)
    expect(isEnronDemoSeedStatusPath(`${ENRON_DEMO_SEED_STATUS_PATH}/`, 'GET')).toBe(true)
    expect(isEnronDemoSeedStatusPath(ENRON_DEMO_SEED_STATUS_PATH, 'POST')).toBe(false)
  })

  it('isEnronDemoReseedPath matches GET only', () => {
    expect(isEnronDemoReseedPath(ENRON_DEMO_RESEED_PATH, 'GET')).toBe(true)
    expect(isEnronDemoReseedPath(`${ENRON_DEMO_RESEED_PATH}/`, 'GET')).toBe(true)
    expect(isEnronDemoReseedPath(ENRON_DEMO_RESEED_PATH, 'POST')).toBe(false)
  })

  it('isEnronDemoUsersListPath matches GET only', () => {
    expect(isEnronDemoUsersListPath(ENRON_DEMO_USERS_PATH, 'GET')).toBe(true)
    expect(isEnronDemoUsersListPath(`${ENRON_DEMO_USERS_PATH}/`, 'GET')).toBe(true)
    expect(isEnronDemoUsersListPath(ENRON_DEMO_USERS_PATH, 'POST')).toBe(false)
  })

  it('isEnronDemoPublicApiPath covers users GET, mint POST, seed-status GET, reseed GET', () => {
    expect(isEnronDemoPublicApiPath(ENRON_DEMO_USERS_PATH, 'GET')).toBe(true)
    expect(isEnronDemoPublicApiPath(ENRON_DEMO_USERS_PATH, 'POST')).toBe(false)
    expect(isEnronDemoPublicApiPath(ENRON_DEMO_MINT_PATH, 'POST')).toBe(true)
    expect(isEnronDemoPublicApiPath(ENRON_DEMO_SEED_STATUS_PATH, 'GET')).toBe(true)
    expect(isEnronDemoPublicApiPath(ENRON_DEMO_SEED_STATUS_PATH, 'POST')).toBe(false)
    expect(isEnronDemoPublicApiPath(ENRON_DEMO_RESEED_PATH, 'GET')).toBe(true)
    expect(isEnronDemoPublicApiPath(ENRON_DEMO_RESEED_PATH, 'POST')).toBe(false)
  })

  it('enronDemoSecretConfigured requires non-empty trimmed secret', () => {
    delete process.env.BRAIN_ENRON_DEMO_SECRET
    expect(enronDemoSecretConfigured()).toBe(false)
    process.env.BRAIN_ENRON_DEMO_SECRET = '   '
    expect(enronDemoSecretConfigured()).toBe(false)
    process.env.BRAIN_ENRON_DEMO_SECRET = 'a'
    expect(enronDemoSecretConfigured()).toBe(true)
    process.env.BRAIN_ENRON_DEMO_SECRET = 'x'.repeat(16)
    expect(enronDemoSecretConfigured()).toBe(true)
  })
})
