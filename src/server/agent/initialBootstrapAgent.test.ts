import { describe, it, expect } from 'vitest'
import {
  DEFAULT_INITIAL_BOOTSTRAP_KICKOFF_INSTRUCTIONS,
  formatMailIndexFactsForBootstrap,
} from './initialBootstrapAgent.js'

describe('initialBootstrapAgent', () => {
  it('DEFAULT_INITIAL_BOOTSTRAP_KICKOFF_INSTRUCTIONS drives wiki-first substantive proposals', () => {
    expect(DEFAULT_INITIAL_BOOTSTRAP_KICKOFF_INSTRUCTIONS).toMatch(/people.page|substantive/i)
    expect(DEFAULT_INITIAL_BOOTSTRAP_KICKOFF_INSTRUCTIONS).toMatch(/find_person/)
    expect(DEFAULT_INITIAL_BOOTSTRAP_KICKOFF_INSTRUCTIONS).toMatch(/web_search/)
    expect(DEFAULT_INITIAL_BOOTSTRAP_KICKOFF_INSTRUCTIONS).toMatch(/common names|narrow/i)
  })
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
