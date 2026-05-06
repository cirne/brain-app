import { describe, it, expect, beforeEach, vi } from 'vitest'

const getMail = vi.hoisted(() => vi.fn())

vi.mock('@server/lib/onboarding/onboardingMailStatus.js', () => ({
  getOnboardingMailStatus: getMail,
}))

import { waitForRipmailBackfillLaneIdle } from './ripmailHeavySpawn.js'

describe('waitForRipmailBackfillLaneIdle', () => {
  beforeEach(() => {
    getMail.mockReset()
  })

  it('returns immediately when backfill is not running', async () => {
    getMail.mockResolvedValue({
      configured: true,
      backfillRunning: false,
    })
    await waitForRipmailBackfillLaneIdle({ pollMs: 5, maxWaitMs: 1000 })
    expect(getMail).toHaveBeenCalledTimes(1)
  })

  it('polls until backfill lane is idle', async () => {
    getMail
      .mockResolvedValueOnce({
        configured: true,
        backfillRunning: true,
      })
      .mockResolvedValueOnce({
        configured: true,
        backfillRunning: true,
      })
      .mockResolvedValue({
        configured: true,
        backfillRunning: false,
      })
    await waitForRipmailBackfillLaneIdle({ pollMs: 5, maxWaitMs: 10_000 })
    expect(getMail.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('throws when maxWaitMs exceeded while backfill still running', async () => {
    getMail.mockResolvedValue({
      configured: true,
      backfillRunning: true,
    })
    await expect(
      waitForRipmailBackfillLaneIdle({ pollMs: 5, maxWaitMs: 25 }),
    ).rejects.toThrow(/still busy/)
  })
})
