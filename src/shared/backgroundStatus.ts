/** Matches supervisor phases in `BackgroundRunDoc` / Your Wiki UI. */
export type YourWikiPhase = 'starting' | 'enriching' | 'cleaning' | 'paused' | 'idle' | 'error'

/** OPP-095 persisted `wiki-bootstrap.json` status (subset for Hub). */
export type WikiBootstrapBackgroundSlice = {
  status: 'not-started' | 'running' | 'completed' | 'failed'
  completedAt: string | null
  skipped?: boolean
  stats?: {
    peopleCreated: number
    projectsCreated: number
    topicsCreated: number
    travelCreated: number
  }
  lastError?: string
}

/** Unified Hub / tooling snapshot (GET `/api/background-status`). */
export type BackgroundStatusResponse = {
  updatedAt: string
  onboardingFlowActive: boolean
  mail: {
    indexedTotal: number
    ftsReady: number | null
    /** Same semantics as {@link ParsedRipmailStatus} / in-process status (denominator for progress when present). */
    messageAvailableForProgress: number | null
    configured: boolean
    dateRange: { from: string | null; to: string | null }
    phase1Complete: boolean
    phase2Complete: boolean
    syncRunning: boolean
    backfillRunning: boolean
    /** Heuristic: which onboarding-era backfill window is active when `backfillRunning`. */
    backfillPhase: '30d' | '1y' | null
    refreshRunning: boolean
    lastSyncedAt: string | null
    syncLockAgeMs: number | null
    pendingBackfill: boolean
    /** Gmail OAuth: ~1y historical slice not marked complete on disk (may still download while idle). */
    deepHistoricalPending?: boolean
    staleMailSyncLock: boolean
    indexingHint?: string | null
    statusError?: string
  }
  wiki: {
    status: 'idle' | 'paused' | 'running' | 'queued' | 'completed' | 'error'
    phase: YourWikiPhase
    pageCount: number
    currentLap: number
    detail: string
    lastRunAt: string | null
    /** Mailbox configured and indexed mail ≥ wiki buildout gate — supervisor auto-start may fire (not tied to onboarding `done`). */
    autoStartEligible: boolean
    /** OPP-095 first-draft bootstrap disk state (before continuous enrich/cleanup laps). */
    bootstrap: WikiBootstrapBackgroundSlice
    /** Lap ran without a confirmed-fresh mail refresh (timeout or error). */
    lapMailSyncStale?: boolean
    error?: string
  }
  onboarding: {
    state: string
    wikiMeExists: boolean
    milestones: {
      interviewReady: boolean
      wikiReady: boolean
      fullySynced: boolean
    }
  }
  /** Recent orchestrator / supervisor failure records (best-effort). */
  orchestrator?: {
    recentFailures: Array<{
      id: string
      type: string
      status: string
      lastError?: string
      completedAt?: string
      createdAt: string
    }>
  }
}
