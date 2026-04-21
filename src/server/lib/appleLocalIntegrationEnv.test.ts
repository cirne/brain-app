import { describe, it, expect, afterEach } from 'vitest'
import { isAppleLocalIntegrationEnvironment } from './appleLocalIntegrationEnv.js'

describe('isAppleLocalIntegrationEnvironment', () => {
  const prevDisable = process.env.BRAIN_DISABLE_APPLE_LOCAL
  const prevForce = process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS

  afterEach(() => {
    if (prevDisable === undefined) delete process.env.BRAIN_DISABLE_APPLE_LOCAL
    else process.env.BRAIN_DISABLE_APPLE_LOCAL = prevDisable
    if (prevForce === undefined) delete process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS
    else process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS = prevForce
  })

  it('returns false when BRAIN_DISABLE_APPLE_LOCAL=1 (even with force tests)', () => {
    process.env.BRAIN_DISABLE_APPLE_LOCAL = '1'
    process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS = '1'
    expect(isAppleLocalIntegrationEnvironment()).toBe(false)
  })

  it('returns true when BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS=1 and not disabled', () => {
    delete process.env.BRAIN_DISABLE_APPLE_LOCAL
    process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS = '1'
    expect(isAppleLocalIntegrationEnvironment()).toBe(true)
  })

  it('matches darwin when neither override is set', () => {
    delete process.env.BRAIN_DISABLE_APPLE_LOCAL
    delete process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS
    expect(isAppleLocalIntegrationEnvironment()).toBe(process.platform === 'darwin')
  })
})
