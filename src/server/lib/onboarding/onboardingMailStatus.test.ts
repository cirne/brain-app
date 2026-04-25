import { describe, expect, it } from 'vitest'
import { onboardingMailDebugLevelFromEnv } from './onboardingMailStatus.js'

describe('onboardingMailDebugLevelFromEnv', () => {
  it('defaults to off', () => {
    expect(onboardingMailDebugLevelFromEnv(undefined)).toBe('off')
    expect(onboardingMailDebugLevelFromEnv('')).toBe('off')
    expect(onboardingMailDebugLevelFromEnv('0')).toBe('off')
    expect(onboardingMailDebugLevelFromEnv('false')).toBe('off')
    expect(onboardingMailDebugLevelFromEnv('noise')).toBe('off')
  })
  it('enables summary or full when requested', () => {
    expect(onboardingMailDebugLevelFromEnv('summary')).toBe('summary')
    expect(onboardingMailDebugLevelFromEnv('1')).toBe('full')
    expect(onboardingMailDebugLevelFromEnv('true')).toBe('full')
    expect(onboardingMailDebugLevelFromEnv('full')).toBe('full')
  })
})
