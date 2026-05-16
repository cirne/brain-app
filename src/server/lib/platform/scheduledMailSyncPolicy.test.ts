import { describe, expect, it } from 'vitest'
import { shouldDeferScheduledRipmailRefreshForTenant } from './scheduledMailSyncPolicy.js'

describe('shouldDeferScheduledRipmailRefreshForTenant', () => {
  const baseSup = {
    loopRunning: true,
    isPaused: false,
    shutdownRequested: false,
    loopTenantUserId: 'usr_abc',
  } as const

  it('does not defer when supervisor is not loop-running', () => {
    expect(
      shouldDeferScheduledRipmailRefreshForTenant(
        'usr_abc',
        { ...baseSup, loopRunning: false },
        { phase: 'enriching', lap: 2 },
      ),
    ).toBe(false)
  })

  it('does not defer for a different tenant than the bound loop', () => {
    expect(
      shouldDeferScheduledRipmailRefreshForTenant(
        'usr_other',
        baseSup,
        { phase: 'enriching', lap: 5 },
      ),
    ).toBe(false)
  })

  it('does not defer when paused', () => {
    expect(
      shouldDeferScheduledRipmailRefreshForTenant(
        'usr_abc',
        { ...baseSup, isPaused: true },
        { phase: 'enriching', lap: 3 },
      ),
    ).toBe(false)
  })

  it('defers surveying/enriching/cleaning for lap >= 2 when this tenant owns the loop', () => {
    expect(
      shouldDeferScheduledRipmailRefreshForTenant('usr_abc', baseSup, { phase: 'surveying', lap: 2 }),
    ).toBe(true)
    expect(
      shouldDeferScheduledRipmailRefreshForTenant('usr_abc', baseSup, { phase: 'enriching', lap: 2 }),
    ).toBe(true)
    expect(
      shouldDeferScheduledRipmailRefreshForTenant('usr_abc', baseSup, { phase: 'cleaning', lap: 4 }),
    ).toBe(true)
  })

  it('does not defer lap 1 — supervisor skips its own pre-lap refresh on first lap', () => {
    expect(
      shouldDeferScheduledRipmailRefreshForTenant('usr_abc', baseSup, { phase: 'surveying', lap: 1 }),
    ).toBe(false)
    expect(
      shouldDeferScheduledRipmailRefreshForTenant('usr_abc', baseSup, { phase: 'enriching', lap: 1 }),
    ).toBe(false)
  })

  it('does not defer idle / starting phases', () => {
    expect(
      shouldDeferScheduledRipmailRefreshForTenant('usr_abc', baseSup, { phase: 'idle', lap: 9 }),
    ).toBe(false)
    expect(
      shouldDeferScheduledRipmailRefreshForTenant('usr_abc', baseSup, { phase: 'starting', lap: 1 }),
    ).toBe(false)
  })
})
