import { ripmailBin } from './ripmailBin.js'
import { execRipmailAsync } from './ripmailExec.js'

/** One row from `ripmail sources list --json`, normalized for Brain Hub. */
export type HubRipmailSourceRow = {
  id: string
  kind: string
  displayName: string
  path: string | null
}

export type HubRipmailSourcesPayload = {
  sources: HubRipmailSourceRow[]
  error?: string
}

function pickDisplayName(r: Record<string, unknown>, id: string): string {
  const label = typeof r.label === 'string' ? r.label.trim() : ''
  if (label) return label
  const email = typeof r.email === 'string' ? r.email.trim() : ''
  if (email) return email
  return id
}

export async function removeHubRipmailSource(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = id?.trim()
  if (!trimmed) return { ok: false, error: 'Source id required' }
  const rm = ripmailBin()
  try {
    await execRipmailAsync(`${rm} sources remove ${JSON.stringify(trimmed)} --json`, {
      timeout: 60_000,
    })
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

export async function getHubRipmailSourcesList(): Promise<HubRipmailSourcesPayload> {
  const rm = ripmailBin()
  try {
    const { stdout } = await execRipmailAsync(`${rm} sources list --json`, { timeout: 15000 })
    const j = JSON.parse(stdout) as { sources?: unknown[] }
    const raw = Array.isArray(j.sources) ? j.sources : []
    const sources: HubRipmailSourceRow[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const id = typeof r.id === 'string' ? r.id : ''
      const kind = typeof r.kind === 'string' ? r.kind : ''
      if (!id || !kind) continue
      const path = typeof r.path === 'string' ? r.path : null
      sources.push({
        id,
        kind,
        displayName: pickDisplayName(r, id),
        path,
      })
    }
    return { sources }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { sources: [], error: msg }
  }
}
