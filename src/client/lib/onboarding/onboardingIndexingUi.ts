/** Quiet period before showing generic patience copy (matches prior “elapsed” timing). */
export const INDEXING_CALM_PATIENCE_MS = 120_000

/**
 * Single-line status for the indexing hero: server actionable hint wins, then one generic
 * patience line after {@link INDEXING_CALM_PATIENCE_MS}.
 */
export function computeIndexingCalmStatus(args: {
  actionableHint: string | null | undefined
  indexingStartedAt: number | null
  nowMs: number
}): string | null {
  const urgent = args.actionableHint?.trim()
  if (urgent) return urgent
  if (args.indexingStartedAt == null) return null
  if (args.nowMs - args.indexingStartedAt < INDEXING_CALM_PATIENCE_MS) return null
  return 'First sync can take a few minutes — you can leave this screen open; we’ll keep working in the background.'
}
