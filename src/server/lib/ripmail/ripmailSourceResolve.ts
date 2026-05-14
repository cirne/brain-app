/**
 * Map agent-provided `--source` strings to ripmail source ids.
 * Apple Mail often uses a placeholder config email while whoami infers real addresses — agents pass
 * inferred emails, which ripmail would reject unless we normalize to the configured source id.
 */

import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { loadRipmailConfig } from '@server/ripmail/sync/config.js'

export type RipmailSourceListRow = {
  id: string
  kind: string
  email?: string
  imap?: { aliases?: string[] } | null
}

function isMailKind(kind: string): boolean {
  return kind === 'imap' || kind === 'applemail'
}

/**
 * Given `ripmail sources list --json` rows, return the source id to pass to `--source`.
 * - Matches exact `id`, case-insensitive `email`, and `imap.aliases`.
 * - If there is exactly one mail source and `spec` looks like an email but does not match config,
 *   returns that source's id (Apple Mail placeholder vs inferred identity).
 */
export function normalizeRipmailSourceSpecifier(spec: string, sources: RipmailSourceListRow[]): string {
  const ids = normalizeRipmailSourceIdsForSearch(spec, sources)
  if (ids.length === 1) return ids[0]!
  if (ids.length > 1) return ids[0]!
  return spec.trim()
}

/**
 * All configured source ids that match `spec` for unified search (`search_index`).
 * When a mailbox email matches both Gmail IMAP and a sibling `googleDrive` source, returns both ids
 * so mail and Drive rows are included.
 */
export function normalizeRipmailSourceIdsForSearch(spec: string, sources: RipmailSourceListRow[]): string[] {
  const s = spec.trim()
  if (!s) return []

  for (const src of sources) {
    if (src.id === s) return [s]
  }

  const mail = sources.filter((x) => isMailKind(x.kind))
  const drives = sources.filter((x) => x.kind === 'googleDrive')
  const matched = new Set<string>()

  for (const m of mail) {
    const em = m.email?.trim()
    if (em && em.toLowerCase() === s.toLowerCase()) matched.add(m.id)
    const aliases = m.imap?.aliases
    if (aliases?.length) {
      for (const a of aliases) {
        if (a.trim().toLowerCase() === s.toLowerCase()) matched.add(m.id)
      }
    }
  }

  for (const d of drives) {
    const em = d.email?.trim()
    if (em && em.toLowerCase() === s.toLowerCase()) matched.add(d.id)
  }

  if (matched.size > 0) return [...matched]

  if (mail.length === 1 && s.includes('@')) {
    return [mail[0]!.id]
  }

  return [s]
}

/** Load sources from config.json and normalize `spec` to a configured source id. */
export async function resolveRipmailSourceForCli(spec: string | undefined): Promise<string | undefined> {
  if (!spec?.trim()) return undefined
  const s = spec.trim()
  try {
    const config = loadRipmailConfig(ripmailHomeForBrain())
    const sources: RipmailSourceListRow[] = (config.sources ?? []).map((src) => ({
      id: src.id,
      kind: src.kind,
      email: src.email,
      imap: src.imap ? { aliases: [] } : null,
    }))
    return normalizeRipmailSourceSpecifier(s, sources)
  } catch {
    return s
  }
}

/** Same as {@link normalizeRipmailSourceIdsForSearch} but loads config from the current brain ripmail home. */
export async function resolveRipmailSourceIdsForSearch(spec: string | undefined): Promise<string[] | undefined> {
  if (!spec?.trim()) return undefined
  const s = spec.trim()
  try {
    const config = loadRipmailConfig(ripmailHomeForBrain())
    const sources: RipmailSourceListRow[] = (config.sources ?? []).map((src) => ({
      id: src.id,
      kind: src.kind,
      email: src.email,
      imap: src.imap ? { aliases: [] } : null,
    }))
    const ids = normalizeRipmailSourceIdsForSearch(s, sources)
    return ids.length ? ids : undefined
  } catch {
    return [s]
  }
}
