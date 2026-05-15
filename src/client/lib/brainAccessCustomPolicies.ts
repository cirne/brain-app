/**
 * Client-only custom brain-access policy presets (per-grant privacy text is still stored server-side).
 * IDs are stable strings like `custom:<uuid>` so URLs and grouping stay consistent.
 */

export type BrainAccessCustomPolicy = {
  id: string
  name: string
  text: string
  /** Index into {@link CUSTOM_POLICY_COLOR_CLASSES} rotation on policy cards. */
  colorIndex: number
}

const STORAGE_KEY = 'brain.brainAccess.customPolicies.v1'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function colorIndexFromOpaqueId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0
  }
  return Math.abs(h) % 5
}

function parsePolicy(v: unknown): BrainAccessCustomPolicy | null {
  if (!isRecord(v)) return null
  const id = typeof v.id === 'string' ? v.id.trim() : ''
  const name = typeof v.name === 'string' ? v.name.trim() : ''
  const text = typeof v.text === 'string' ? v.text : ''
  const colorIndex = typeof v.colorIndex === 'number' && Number.isFinite(v.colorIndex) ? Math.floor(v.colorIndex) : 0
  const isServer = id.startsWith('bqc_')
  const isLegacyLocal = id.startsWith('custom:')
  if ((!isServer && !isLegacyLocal) || name.length === 0 || text.trim().length === 0) return null
  return { id, name, text: text.trim(), colorIndex: isServer ? colorIndexFromOpaqueId(id) : colorIndex }
}

/** Maps `GET /api/brain-query/policies` for Hub grouping and titles. */
export async function fetchBrainAccessCustomPoliciesFromServer(): Promise<BrainAccessCustomPolicy[] | null> {
  try {
    const res = await fetch('/api/brain-query/policies')
    if (!res.ok) return null
    const j = (await res.json()) as { policies?: unknown }
    const arr = j.policies
    if (!Array.isArray(arr)) return null
    const out: BrainAccessCustomPolicy[] = []
    for (const row of arr) {
      if (!isRecord(row)) continue
      const id = typeof row.id === 'string' ? row.id.trim() : ''
      const title =
        typeof row.title === 'string'
          ? row.title.trim()
          : typeof row.label === 'string'
            ? row.label.trim()
            : ''
      const body = typeof row.body === 'string' ? row.body : ''
      if (!id.startsWith('bqc_') || !title || !body.trim()) continue
      out.push({
        id,
        name: title,
        text: body.trim(),
        colorIndex: colorIndexFromOpaqueId(id),
      })
    }
    return out
  } catch {
    return null
  }
}

/** Loaded policies only — invalid rows are dropped. */
export function loadBrainAccessCustomPolicies(): BrainAccessCustomPolicy[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const j = JSON.parse(raw) as unknown
    if (!Array.isArray(j)) return []
    const out: BrainAccessCustomPolicy[] = []
    for (const row of j) {
      const p = parsePolicy(row)
      if (p) out.push(p)
    }
    return out
  } catch {
    return []
  }
}

/** Combine server-backed `bqc_` policies with legacy `custom:` rows still in localStorage. */
export function mergeServerAndLegacyCustomPolicies(remote: BrainAccessCustomPolicy[] | null): BrainAccessCustomPolicy[] {
  const local = loadBrainAccessCustomPolicies()
  if (remote == null) return local
  const byId = new Map<string, BrainAccessCustomPolicy>()
  for (const p of remote) byId.set(p.id, p)
  for (const p of local) {
    if (p.id.startsWith('custom:') && !byId.has(p.id)) byId.set(p.id, p)
  }
  return [...byId.values()]
}

export function saveBrainAccessCustomPolicies(policies: BrainAccessCustomPolicy[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(policies))
}

export function addBrainAccessCustomPolicy(input: {
  name: string
  text: string
  colorIndex: number
}): BrainAccessCustomPolicy {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `custom:${crypto.randomUUID()}`
      : `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const policy: BrainAccessCustomPolicy = {
    id,
    name: input.name.trim(),
    text: input.text.trim(),
    colorIndex: input.colorIndex,
  }
  const next = [...loadBrainAccessCustomPolicies(), policy]
  saveBrainAccessCustomPolicies(next)
  return policy
}

/** Update stored body (and optional name) for a `custom:…` policy. Returns false if the id is missing. */
export function updateBrainAccessCustomPolicy(id: string, text: string, name?: string): boolean {
  const list = loadBrainAccessCustomPolicies()
  const i = list.findIndex((p) => p.id === id)
  if (i < 0) return false
  const row = list[i]
  if (!row) return false
  const nextName = name !== undefined ? name.trim() : row.name
  const nextRow: BrainAccessCustomPolicy = { ...row, text: text.trim(), name: nextName }
  if (nextRow.text.length === 0 || nextRow.name.length === 0) return false
  const next = [...list.slice(0, i), nextRow, ...list.slice(i + 1)]
  saveBrainAccessCustomPolicies(next)
  return true
}

/** Remove a saved custom preset by id. Returns false if missing or id is not `custom:…`. */
export function removeBrainAccessCustomPolicy(id: string): boolean {
  if (!id.startsWith('custom:')) return false
  const list = loadBrainAccessCustomPolicies()
  const next = list.filter((p) => p.id !== id)
  if (next.length === list.length) return false
  saveBrainAccessCustomPolicies(next)
  return true
}
