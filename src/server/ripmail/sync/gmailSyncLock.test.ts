import { afterEach, describe, expect, it } from 'vitest'
import { __resetGmailSourceFlightsForTests, withGmailSourceFlight } from './gmailSyncLock.js'

describe('withGmailSourceFlight', () => {
  afterEach(() => {
    __resetGmailSourceFlightsForTests()
  })

  it('skips refresh when backfill is in flight', async () => {
    let releaseBackfill!: () => void
    const backfillGate = new Promise<void>((resolve) => {
      releaseBackfill = resolve
    })

    const backfillPromise = withGmailSourceFlight('src1', 'backfill', async () => {
      await backfillGate
      return 'backfill-done'
    })

    await new Promise((r) => setTimeout(r, 10))

    const refresh = await withGmailSourceFlight('src1', 'refresh', async () => 'refresh-done')

    expect(refresh.ran).toBe(false)
    if (!refresh.ran) {
      expect(refresh.skipped).toBe(true)
      expect(refresh.reason).toBe('backfill_active')
    }

    releaseBackfill!()
    await expect(backfillPromise).resolves.toEqual({ ran: true, value: 'backfill-done' })
  })

  it('runs refresh after backfill completes', async () => {
    await withGmailSourceFlight('src1', 'backfill', async () => 'b')
    const refresh = await withGmailSourceFlight('src1', 'refresh', async () => 'r')
    expect(refresh).toEqual({ ran: true, value: 'r' })
  })

  it('waits for in-flight refresh before backfill', async () => {
    const order: string[] = []
    const refresh = withGmailSourceFlight('src1', 'refresh', async () => {
      order.push('refresh-start')
      await new Promise<void>((r) => {
        setTimeout(() => {
          order.push('refresh-end')
          r()
        }, 20)
      })
      return 'r'
    })

    await new Promise((r) => setTimeout(r, 5))
    const backfill = await withGmailSourceFlight('src1', 'backfill', async () => {
      order.push('backfill')
      return 'b'
    })

    await refresh
    expect(backfill).toEqual({ ran: true, value: 'b' })
    expect(order).toEqual(['refresh-start', 'refresh-end', 'backfill'])
  })
})
