import { describe, expect, it } from 'vitest'
import {
  computeIndexingCalmStatus,
  INDEXING_CALM_PATIENCE_MS,
} from './onboardingIndexingUi.js'

describe('computeIndexingCalmStatus', () => {
  const t0 = 1_000_000_000_000

  it('returns actionable hint first', () => {
    const hint = 'Quit the app and restart.'
    expect(
      computeIndexingCalmStatus({
        actionableHint: hint,
        indexingStartedAt: t0,
        nowMs: t0 + INDEXING_CALM_PATIENCE_MS + 1,
      }),
    ).toBe(hint)
  })

  it('returns null with no hint and no start time', () => {
    expect(
      computeIndexingCalmStatus({
        actionableHint: null,
        indexingStartedAt: null,
        nowMs: t0,
      }),
    ).toBeNull()
  })

  it('returns null under patience window', () => {
    expect(
      computeIndexingCalmStatus({
        actionableHint: null,
        indexingStartedAt: t0,
        nowMs: t0 + INDEXING_CALM_PATIENCE_MS - 1,
      }),
    ).toBeNull()
  })

  it('returns generic patience at or after window', () => {
    const line = computeIndexingCalmStatus({
      actionableHint: null,
      indexingStartedAt: t0,
      nowMs: t0 + INDEXING_CALM_PATIENCE_MS,
    })
    expect(line).toContain('First sync')
  })
})
