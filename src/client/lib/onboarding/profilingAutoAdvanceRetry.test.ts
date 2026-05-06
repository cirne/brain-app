import { describe, expect, it } from 'vitest'
import { ONBOARDING_BACKFILL_STILL_RUNNING_CODE } from '@shared/onboardingProfileThresholds.js'
import { shouldRetryProfilingAutoAdvance } from './profilingAutoAdvanceRetry.js'

describe('shouldRetryProfilingAutoAdvance', () => {
  const noBf = undefined

  it('allows attempt when there was no prior failure', () => {
    expect(shouldRetryProfilingAutoAdvance(500, null, noBf, false)).toBe(true)
  })

  it('blocks retry at the same indexed count after a failure', () => {
    expect(shouldRetryProfilingAutoAdvance(1000, 1000, noBf, false)).toBe(false)
    expect(shouldRetryProfilingAutoAdvance(200, 200, undefined, false)).toBe(false)
  })

  it('allows retry when indexed count increased after failure', () => {
    expect(shouldRetryProfilingAutoAdvance(1001, 1000, noBf, false)).toBe(true)
    expect(shouldRetryProfilingAutoAdvance(201, 200, undefined, false)).toBe(true)
  })

  it('allows retry when last failure was backfill-busy and backfill lane is idle now', () => {
    expect(
      shouldRetryProfilingAutoAdvance(
        200,
        200,
        ONBOARDING_BACKFILL_STILL_RUNNING_CODE,
        false,
      ),
    ).toBe(true)
  })

  it('blocks retry while backfill-busy rejection has not cleared on the client poll', () => {
    expect(
      shouldRetryProfilingAutoAdvance(
        200,
        200,
        ONBOARDING_BACKFILL_STILL_RUNNING_CODE,
        true,
      ),
    ).toBe(false)
  })
})
