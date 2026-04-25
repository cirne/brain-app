import { getOnboardingMailStatus } from '@server/lib/onboarding/onboardingMailStatus.js'
import { syncInboxRipmail } from '@server/lib/platform/syncAll.js'

const INTERVAL_MS = 60_000

let timer: ReturnType<typeof setInterval> | undefined

/**
 * Periodically kicks `ripmail refresh` when ripmail reports backfill work pending and no live sync.
 * Complements the long default `SYNC_INTERVAL_SECONDS` so IMAP drops resume within about a minute.
 */
export function startRipmailBackfillSupervisor(): void {
  if (timer !== undefined) return
  timer = setInterval(() => {
    void tick()
  }, INTERVAL_MS)
}

export function stopRipmailBackfillSupervisor(): void {
  if (timer === undefined) return
  clearInterval(timer)
  timer = undefined
}

async function tick(): Promise<void> {
  try {
    const mail = await getOnboardingMailStatus()
    if (!mail.configured) return
    if (mail.statusError) return
    if (mail.staleMailSyncLock) return
    if (mail.syncRunning) return
    if (!mail.pendingBackfill) return
    console.log('[brain-app] ripmail backfill supervisor: kicking refresh')
    await syncInboxRipmail()
  } catch (e) {
    console.error('[brain-app] ripmail backfill supervisor:', e)
  }
}
