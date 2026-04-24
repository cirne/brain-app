import { describe, expect, it } from 'vitest'
import { computeIndexingCalmStatus } from './onboardingIndexingUi.js'

describe('computeIndexingCalmStatus', () => {
  it('returns trimmed actionable hint when present', () => {
    const hint = '  Try reconnecting.  '
    expect(computeIndexingCalmStatus({ actionableHint: hint })).toBe('Try reconnecting.')
  })

  it('returns null when hint is empty', () => {
    expect(computeIndexingCalmStatus({ actionableHint: null })).toBeNull()
    expect(computeIndexingCalmStatus({ actionableHint: undefined })).toBeNull()
    expect(computeIndexingCalmStatus({ actionableHint: '   ' })).toBeNull()
  })
})
