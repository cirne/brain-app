/**
 * Compact ripmail source list for the main assistant system prompt so models stop
 * inventing `source=` values (folder labels, vendor names, etc.).
 */

import { ripmailBin } from './ripmailBin.js'
import { execRipmailAsync } from './ripmailRun.js'

export type RipmailSourceListEntry = {
  id?: unknown
  kind?: unknown
  email?: unknown
  label?: unknown
}

/** Pure formatter — tested without spawning ripmail. */
export function formatRipmailSourcesForPrompt(stdout: string): string {
  const raw = stdout.trim()
  if (!raw) return ''
  try {
    const j = JSON.parse(raw) as { sources?: RipmailSourceListEntry[] }
    const rows = j.sources ?? []
    if (!Array.isArray(rows) || rows.length === 0) return ''

    const lines = rows.map((s) => {
      const id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : '?'
      const kind = typeof s.kind === 'string' && s.kind.trim() ? s.kind.trim() : '?'
      const parts: string[] = [kind]
      const label = typeof s.label === 'string' ? s.label.trim() : ''
      if (label) parts.push(`label "${label}"`)
      const email = typeof s.email === 'string' ? s.email.trim() : ''
      if (email) parts.push(email)
      return `- \`${id}\` — ${parts.join('; ')}`
    })

    return [
      '## Configured ripmail sources (this session)',
      '',
      ...lines,
      '',
      'These **`id` strings** are the only valid **`source` tool-argument values** (plus mailbox emails shown above where applicable). **Human phrases** (“NetJets folder”, vendor names, project nicknames) are **not** source ids — put those in **`search_index` `pattern`**, not `source`. When unsure, call **`manage_sources` op=list**.',
    ].join('\n')
  } catch {
    return ''
  }
}

/** Runs `ripmail sources list --json`; empty string if ripmail is missing or errors. */
export async function buildRipmailSourcesPromptSection(): Promise<string> {
  try {
    const rm = ripmailBin()
    const { stdout } = await execRipmailAsync(`${rm} sources list --json`, { timeout: 12000 })
    return formatRipmailSourcesForPrompt(stdout)
  } catch {
    return ''
  }
}
