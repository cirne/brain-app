/**
 * Local-only draft text for built-in policy buckets when the user has zero grants.
 * Once collaborators exist, grant `privacyPolicy` is authoritative and drafts are ignored.
 */
const STORAGE_KEY = 'brain.brainAccess.builtinPolicyDrafts.v1'

function readMap(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const j = JSON.parse(raw) as unknown
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim()
    }
    return out
  } catch {
    return {}
  }
}

function writeMap(m: Record<string, string>): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(m))
}

export function loadBuiltinPolicyDraft(policyId: string): string | undefined {
  const v = readMap()[policyId]
  return v !== undefined && v.length > 0 ? v : undefined
}

export function saveBuiltinPolicyDraft(policyId: string, text: string): void {
  const t = text.trim()
  const m = readMap()
  if (t.length === 0) {
    delete m[policyId]
    writeMap(m)
    return
  }
  m[policyId] = t
  writeMap(m)
}

export function clearBuiltinPolicyDraft(policyId: string): void {
  const m = readMap()
  if (!(policyId in m)) return
  delete m[policyId]
  writeMap(m)
}
