import { describe, it, expect } from 'vitest'
import { formatMailIndexFactsForBootstrap } from './initialBootstrapAgent.js'

describe('initialBootstrapAgent', () => {
  it('formatMailIndexFactsForBootstrap includes date span and lane flags', () => {
    const block = formatMailIndexFactsForBootstrap({
      configured: true,
      indexedTotal: 120,
      ftsReady: 118,
      dateRange: { from: '2025-01-01', to: '2026-05-01' },
      refreshRunning: false,
      backfillRunning: true,
      pendingBackfill: true,
      syncRunning: false,
      indexingHint: null,
      lastSyncedAt: null,
      syncLockAgeMs: null,
      messageAvailableForProgress: null,
      staleMailSyncLock: false,
    })
    expect(block).toContain('Mailbox configured: true')
    expect(block).toContain('Date span in index: 2025-01-01 → 2026-05-01')
    expect(block).toContain('backfill lane running: true')
    expect(block).toContain('pendingBackfill: true')
  })
})
