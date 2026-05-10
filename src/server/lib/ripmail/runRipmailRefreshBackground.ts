import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { runRipmailRefreshForBrain } from './ripmailHeavySpawn.js'

/** Fire-and-forget `ripmail refresh` (IMAP/calendar sync can run a long time). */
export function runRipmailRefreshInBackground(sourceId: string | undefined, logMessage: string): { ok: true } {
  const extra = sourceId?.trim() ? ['--source', sourceId.trim()] : []
  void Promise.resolve(runRipmailRefreshForBrain(extra)).catch((e: unknown) => {
    brainLogger.error({ err: e, sourceId: sourceId?.trim() ?? null }, logMessage)
  })
  return { ok: true }
}
