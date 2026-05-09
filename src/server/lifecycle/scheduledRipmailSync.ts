/**
 * Periodic `ripmail refresh` for every tenant under BRAIN_DATA_ROOT (server process).
 * Defers ticks when Your Wiki supervisor is mid-lap for the same tenant (see scheduledMailSyncPolicy).
 */
import { YOUR_WIKI_DOC_ID, getWikiSupervisorMailSyncDeferSnapshot } from '@server/agent/yourWikiSupervisor.js'
import { readBackgroundRun } from '@server/lib/chat/backgroundAgentStore.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { readOnboardingStateDoc } from '@server/lib/onboarding/onboardingState.js'
import { getOnboardingMailStatus } from '@server/lib/onboarding/onboardingMailStatus.js'
import {
  shouldDeferScheduledRipmailRefreshForTenant,
  type ScheduledMailWikiDocSlice,
  type WikiSupervisorMailSyncDeferSnapshot,
} from '@server/lib/platform/scheduledMailSyncPolicy.js'
import { getSyncIntervalMs, syncInboxRipmail } from '@server/lib/platform/syncAll.js'
import { listTenantUserIdsUnderDataRoot } from '@server/lib/tenant/listTenantUserIdsUnderDataRoot.js'
import { tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { readHandleMeta } from '@server/lib/tenant/handleMeta.js'
import { runWithTenantContextAsync, type TenantContext } from '@server/lib/tenant/tenantContext.js'

let sweepInFlight = false
let timer: ReturnType<typeof setInterval> | null = null

async function resolveTenantContext(tenantUserId: string): Promise<TenantContext> {
  const homeDir = tenantHomeDir(tenantUserId)
  const meta = await readHandleMeta(homeDir)
  return {
    tenantUserId,
    workspaceHandle: meta?.handle ?? tenantUserId,
    homeDir,
  }
}

async function runScheduledRipmailForTenant(params: {
  tenantUserId: string
  sup: WikiSupervisorMailSyncDeferSnapshot
}): Promise<void> {
  const { tenantUserId, sup } = params
  const ctx = await resolveTenantContext(tenantUserId)
  await runWithTenantContextAsync(ctx, async () => {
    const onboarding = await readOnboardingStateDoc()
    if (onboarding.state === 'not-started' || onboarding.state === 'indexing') return

    const mail = await getOnboardingMailStatus()
    if (!mail.configured) return
    if (mail.staleMailSyncLock) return

    const wikiRaw = await readBackgroundRun(YOUR_WIKI_DOC_ID)
    const wikiSlice: ScheduledMailWikiDocSlice = {
      phase: wikiRaw?.phase,
      lap: wikiRaw?.lap,
    }
    if (shouldDeferScheduledRipmailRefreshForTenant(tenantUserId, sup, wikiSlice)) {
      brainLogger.debug(
        {
          tenantUserId,
          wikiPhase: wikiSlice.phase,
          lap: wikiSlice.lap,
        },
        '[scheduled-mail] defer — wiki supervisor mid-lap for this tenant',
      )
      return
    }

    const res = await syncInboxRipmail()
    if (!res.ok) {
      brainLogger.warn(
        { tenantUserId, error: res.error ?? 'unknown' },
        '[scheduled-mail] ripmail refresh failed',
      )
    }
  })
}

async function sweepOnce(): Promise<void> {
  if (sweepInFlight) return
  sweepInFlight = true
  const sup = getWikiSupervisorMailSyncDeferSnapshot()

  let tenants: string[]
  try {
    tenants = await listTenantUserIdsUnderDataRoot()
  } catch (e) {
    brainLogger.warn({ error: String(e) }, '[scheduled-mail] list tenants failed')
    sweepInFlight = false
    return
  }

  for (const tenantUserId of tenants) {
    try {
      await runScheduledRipmailForTenant({ tenantUserId, sup })
    } catch (e) {
      brainLogger.warn({ tenantUserId, error: String(e) }, '[scheduled-mail] tenant sweep failed')
    }
  }
  sweepInFlight = false
}

/**
 * Starts periodic `ripmail refresh` sweeps for all tenants on disk.
 * Interval is {@link getSyncIntervalMs()} from `SYNC_INTERVAL_SECONDS` (default 300).
 * Returns stop function (called on SIGINT/SIGTERM).
 */
export function startScheduledRipmailSync(): () => void {
  const ms = getSyncIntervalMs()
  if (ms <= 0) {
    return () => {}
  }

  timer = setInterval(() => {
    void sweepOnce()
  }, ms)

  brainLogger.info({ intervalMs: ms }, '[scheduled-mail] periodic ripmail sync enabled')
  void sweepOnce()

  return () => {
    if (timer != null) {
      clearInterval(timer)
      timer = null
      brainLogger.info({}, '[scheduled-mail] periodic ripmail sync stopped')
    }
  }
}

/** @internal Vitest */
export async function __runScheduledRipmailSweepOnceForTests(): Promise<void> {
  await sweepOnce()
}

/** @internal Vitest */
export function __resetScheduledRipmailSyncCoordinatorForTests(): void {
  sweepInFlight = false
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
}
