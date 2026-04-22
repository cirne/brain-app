export type BuildIndexingElapsedLineOptions = {
  /**
   * True when the “Getting to Know You” mail progress hero is shown while server state is still
   * `not-started` (race / recovery). Same elapsed copy as `state === 'indexing'`.
   */
  mailIndexingHero?: boolean
}

/**
 * Reassuring copy after indexing has run a while (wall-clock from `indexingStartedAt`).
 * Returns null when not on indexing step, no start time, or under 2 minutes.
 */
export function buildIndexingElapsedLine(
  state: string,
  indexingStartedAt: number | null,
  nowMs: number,
  options?: BuildIndexingElapsedLineOptions,
): string | null {
  const onIndexingUi =
    state === 'indexing' || (state === 'not-started' && options?.mailIndexingHero === true)
  if (!onIndexingUi || indexingStartedAt === null) return null
  const min = Math.floor((nowMs - indexingStartedAt) / 60000)
  if (min < 2) return null
  if (min < 5) {
    return 'Still working — the first batch can take a few minutes on a large mailbox.'
  }
  return `About ${min} minutes so far — you can leave this screen open; we’ll continue in the background.`
}
