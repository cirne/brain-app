import { compareHubRipmailSources } from '@client/lib/hub/hubSourceOrdering.js'
import type { HubRipmailSourceRow } from '@client/lib/hub/hubRipmailSource.js'

/** Kinds that participate in the unified Google account connections row (Gmail OAuth + Calendar + Drive). */
export function isGoogleBundleSurfaceKind(kind: string): boolean {
  return kind === 'googleCalendar' || kind === 'googleDrive' || kind === 'imap'
}

/**
 * Cluster key shared by sources wired to the same Google account.
 *
 * Always normalises to the account email address so that imap, googleCalendar, and
 * googleDrive sources for the same Google account land in the same bucket even when
 * the ripmail config stores different oauthSourceId values for each service.
 *
 * Non-OAuth IMAP (no oauthSourceId and no email) is excluded — it stays as a single row.
 */
export function googleAccountClusterKey(s: HubRipmailSourceRow): string | null {
  if (!isGoogleBundleSurfaceKind(s.kind)) return null
  const oid = s.oauthSourceId?.trim()
  const em = s.email?.trim()
  const dn = s.displayName.trim()
  if (s.kind === 'imap') {
    // Require at least one OAuth marker so plain IMAP accounts stay standalone.
    if (!oid && !em) return null
    // Prefer email (canonical account identity); fall back to displayName which
    // sourceDisplayName() sets to the email address for Google OAuth accounts.
    return (em || dn).toLowerCase() || null
  }
  // googleCalendar / googleDrive: always cluster; prefer email, then displayName.
  // oauthSourceId here is the linked imap source id (not the email), so skip it.
  return (em || dn).toLowerCase() || null
}

function pickPanelEmailForGroup(sources: HubRipmailSourceRow[]): string {
  const withEmail = sources.map((s) => s.email?.trim()).find((e) => e && e.length > 0)
  if (withEmail) return withEmail
  const mail = sources.find((s) => s.kind === 'imap')
  if (mail?.displayName.trim()) return mail.displayName.trim()
  return sources[0]?.displayName.trim() ?? ''
}

function representativeForSort(sources: HubRipmailSourceRow[]): HubRipmailSourceRow {
  const mail = sources.find((s) => s.kind === 'imap')
  if (mail) return mail
  const cal = sources.find((s) => s.kind === 'googleCalendar')
  if (cal) return cal
  return sources[0]
}

export type SettingsConnectionListEntry =
  | { type: 'google-account'; panelEmail: string; sources: HubRipmailSourceRow[] }
  | { type: 'single'; source: HubRipmailSourceRow }

/**
 * Build ordered rows for Settings → Connections: one row per Google account cluster, standalone rows otherwise.
 */
export function buildSettingsConnectionListEntries(sources: HubRipmailSourceRow[]): SettingsConnectionListEntry[] {
  const byKey = new Map<string, HubRipmailSourceRow[]>()
  for (const s of sources) {
    const ck = googleAccountClusterKey(s)
    if (!ck) continue
    const arr = byKey.get(ck) ?? []
    arr.push(s)
    byKey.set(ck, arr)
  }
  const groupedIds = new Set<string>()
  for (const arr of byKey.values()) {
    for (const s of arr) groupedIds.add(s.id)
  }

  const entries: SettingsConnectionListEntry[] = []
  for (const s of sources) {
    if (!groupedIds.has(s.id)) {
      entries.push({ type: 'single', source: s })
    }
  }
  for (const arr of byKey.values()) {
    if (arr.length === 0) continue
    entries.push({
      type: 'google-account',
      panelEmail: pickPanelEmailForGroup(arr),
      sources: arr,
    })
  }

  entries.sort((a, b) => {
    const ra = a.type === 'single' ? a.source : representativeForSort(a.sources)
    const rb = b.type === 'single' ? b.source : representativeForSort(b.sources)
    return compareHubRipmailSources(ra, rb)
  })
  return entries
}

/** Sources that belong on the unified Google account panel for a URL `panelEmail` (lowercased display/email match + OAuth expansion). */
export function sourcesForGoogleAccountPanel(
  all: HubRipmailSourceRow[],
  panelEmail: string,
): HubRipmailSourceRow[] {
  const want = panelEmail.trim().toLowerCase()
  if (!want) return []
  const candidates = all.filter((s) => googleAccountClusterKey(s) != null)
  const seed = candidates.filter(
    (s) =>
      s.displayName.trim().toLowerCase() === want || s.email?.trim().toLowerCase() === want,
  )
  if (seed.length === 0) {
    return candidates.filter((s) => googleAccountClusterKey(s) === want)
  }
  const keys = new Set(seed.map((s) => googleAccountClusterKey(s)!))
  return candidates.filter((s) => keys.has(googleAccountClusterKey(s)!))
}
