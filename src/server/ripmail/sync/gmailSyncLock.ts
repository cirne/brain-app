/**
 * In-process flight lock per Gmail OAuth source — backfill defers competing refresh.
 */

import { brainLogger } from '@server/lib/observability/brainLogger.js'

type Flight = {
  lane: 'refresh' | 'backfill'
  done: Promise<void>
}

const flights = new Map<string, Flight>()

export type GmailSourceFlightResult<T> =
  | { ran: true; value: T }
  | { ran: false; skipped: true; reason: 'backfill_active' }

/**
 * Serialize Gmail sync per source. Refresh skips when backfill is in flight;
 * backfill waits for an in-flight refresh to finish.
 */
export async function withGmailSourceFlight<T>(
  sourceId: string,
  lane: 'refresh' | 'backfill',
  fn: () => Promise<T>,
): Promise<GmailSourceFlightResult<T>> {
  const existing = flights.get(sourceId)
  if (existing) {
    if (lane === 'refresh' && existing.lane === 'backfill') {
      brainLogger.info({ sourceId, lane }, 'ripmail:gmail:refresh-deferred-backfill-active')
      return { ran: false, skipped: true, reason: 'backfill_active' }
    }
    await existing.done.catch(() => {})
  }

  let release!: () => void
  const done = new Promise<void>((resolve) => {
    release = resolve
  })
  flights.set(sourceId, { lane, done })
  try {
    const value = await fn()
    return { ran: true, value }
  } finally {
    flights.delete(sourceId)
    release()
  }
}

/** @internal Vitest */
export function __resetGmailSourceFlightsForTests(): void {
  flights.clear()
}
