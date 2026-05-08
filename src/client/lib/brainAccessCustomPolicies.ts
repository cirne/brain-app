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

function parsePolicy(v: unknown): BrainAccessCustomPolicy | null {
  if (!isRecord(v)) return null
  const id = typeof v.id === 'string' ? v.id.trim() : ''
  const name = typeof v.name === 'string' ? v.name.trim() : ''
  const text = typeof v.text === 'string' ? v.text : ''
  const colorIndex = typeof v.colorIndex === 'number' && Number.isFinite(v.colorIndex) ? Math.floor(v.colorIndex) : 0
  if (!id.startsWith('custom:') || name.length === 0 || text.trim().length === 0) return null
  return { id, name, text: text.trim(), colorIndex }
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
