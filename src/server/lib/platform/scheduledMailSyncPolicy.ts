import type { YourWikiPhase } from '@server/lib/chat/backgroundAgentStore.js'

/** Snapshot read from wiki supervisor internals for mail deferral (no ALS). */
export type WikiSupervisorMailSyncDeferSnapshot = {
  loopRunning: boolean
  isPaused: boolean
  shutdownRequested: boolean
  /** Tenant ALS id for the supervisor loop in this OS process (`null` if unknown). */
  loopTenantUserId: string | null
}

/** Phase + lap from persisted Your Wiki doc (tenant-scoped on disk). */
export type ScheduledMailWikiDocSlice = {
  phase?: YourWikiPhase
  lap?: number
}

/**
 * Skip server-scheduled ripmail refresh when this process is actively running wiki survey/execute/cleanup
 * laps for **this** tenant and a pre-lap mail refresh already ran for the current lap (lap ≥ 2).
 * Lap 1 skips supervisor-owned refresh intentionally — scheduled refresh still runs.
 */
export function shouldDeferScheduledRipmailRefreshForTenant(
  tenantUserId: string,
  sup: WikiSupervisorMailSyncDeferSnapshot,
  wikiDoc: ScheduledMailWikiDocSlice,
): boolean {
  if (!sup.loopRunning || sup.isPaused || sup.shutdownRequested) return false
  if (sup.loopTenantUserId == null || sup.loopTenantUserId !== tenantUserId) return false
  const lap = wikiDoc.lap ?? 0
  const phase = wikiDoc.phase
  if (lap < 2) return false
  return phase === 'starting' || phase === 'surveying' || phase === 'enriching' || phase === 'cleaning'
}
