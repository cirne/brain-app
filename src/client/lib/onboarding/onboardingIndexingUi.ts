import type { OnboardingMailStatus } from './onboardingTypes.js'

/** Human-readable sync lock age from the server (updates every mail status poll). */
export function formatSyncLockAgeMs(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 1000) return null
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

/** Live progress: message count and/or sync lock age (ripmail does not stream finer-grained %). */
export function buildIndexingProgressLine(mail: OnboardingMailStatus): string | null {
  const parts: string[] = []
  const n = mail.indexedTotal
  if (n != null && n > 0) {
    parts.push(`${n.toLocaleString()} messages indexed so far`)
  }
  if (mail.syncRunning) {
    const age = formatSyncLockAgeMs(mail.syncLockAgeMs)
    parts.push(age ? `Sync running (${age})` : 'Sync running')
  }
  if (parts.length === 0) return null
  return parts.join(' · ')
}

/**
 * Reassuring copy after indexing has run a while (wall-clock from `indexingStartedAt`).
 * Returns null when not on indexing step, no start time, or under 2 minutes.
 */
export function buildIndexingElapsedLine(
  state: string,
  indexingStartedAt: number | null,
  nowMs: number,
): string | null {
  if (state !== 'indexing' || indexingStartedAt === null) return null
  const min = Math.floor((nowMs - indexingStartedAt) / 60000)
  if (min < 2) return null
  if (min < 5) {
    return 'Still working — the first batch can take a few minutes on a large mailbox.'
  }
  return `About ${min} minutes so far — you can leave this screen open; we’ll continue in the background.`
}
