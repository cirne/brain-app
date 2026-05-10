import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { refresh as ripmailRefresh } from '@server/ripmail/sync/index.js'

/** Fire-and-forget in-process ripmail refresh (IMAP/calendar sync can run a long time). */
export function runRipmailRefreshInBackground(sourceId: string | undefined, logMessage: string): { ok: true } {
  const sid = sourceId?.trim() || undefined
  void ripmailRefresh(ripmailHomeForBrain(), { sourceId: sid }).catch((e: unknown) => {
    brainLogger.error({ err: e, sourceId: sid ?? null }, logMessage)
  })
  return { ok: true }
}
