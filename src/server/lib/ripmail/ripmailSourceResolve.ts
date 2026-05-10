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
  const s = spec.trim()
  if (!s) return s

  const mail = sources.filter((x) => isMailKind(x.kind))
  for (const m of mail) {
    if (m.id === s) return s
    const em = m.email?.trim()
    if (em && em.toLowerCase() === s.toLowerCase()) return m.id
    const aliases = m.imap?.aliases
    if (aliases?.length) {
      for (const a of aliases) {
        if (a.trim().toLowerCase() === s.toLowerCase()) return m.id
      }
    }
  }

  if (mail.length === 1 && s.includes('@')) {
    return mail[0].id
  }

  return s
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
