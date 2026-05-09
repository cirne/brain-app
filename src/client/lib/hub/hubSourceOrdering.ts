import type { HubRipmailSourceRow } from './hubRipmailSource.js'

/** Sort tier: mail → calendars → local/cloud folders → other. */
export function hubSourceTier(kind: string): number {
  if (kind === 'imap' || kind === 'applemail') return 0
  if (
    kind === 'googleCalendar' ||
    kind === 'appleCalendar' ||
    kind === 'icsSubscription' ||
    kind === 'icsFile'
  ) {
    return 1
  }
  if (kind === 'localDir' || kind === 'googleDrive') return 2
  return 3
}

export function compareHubRipmailSources(a: HubRipmailSourceRow, b: HubRipmailSourceRow): number {
  const t = hubSourceTier(a.kind) - hubSourceTier(b.kind)
  if (t !== 0) return t
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
}

export function sortHubRipmailSources<T extends HubRipmailSourceRow>(sources: readonly T[]): T[] {
  return [...sources].sort(compareHubRipmailSources)
}
