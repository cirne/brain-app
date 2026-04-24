/**
 * Optional one-line status under the mail indexing bar (server `indexingHint` only).
 * No timer-based fallback copy.
 */
export function computeIndexingCalmStatus(args: {
  actionableHint: string | null | undefined
}): string | null {
  const h = args.actionableHint?.trim()
  return h || null
}
