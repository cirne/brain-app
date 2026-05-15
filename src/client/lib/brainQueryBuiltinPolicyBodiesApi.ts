import {
  BRAIN_QUERY_BUILTIN_POLICY_IDS,
  type BrainQueryBuiltinPolicyId,
} from '@shared/brainQueryBuiltinPolicyIds.js'

let cache: Record<BrainQueryBuiltinPolicyId, string> | null = null
let inflight: Promise<Record<BrainQueryBuiltinPolicyId, string>> | null = null

/** Test-only: clear module cache so fetch runs again. */
export function resetBrainQueryBuiltinPolicyBodiesCacheForTests(): void {
  cache = null
  inflight = null
}

function parseBodiesPayload(json: unknown): Record<BrainQueryBuiltinPolicyId, string> {
  if (!json || typeof json !== 'object') throw new Error('builtin-policy-bodies: invalid json')
  const raw = (json as Record<string, unknown>).bodies
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('builtin-policy-bodies: missing bodies')
  }
  const b = raw as Record<string, unknown>
  const out = {} as Record<BrainQueryBuiltinPolicyId, string>
  for (const id of BRAIN_QUERY_BUILTIN_POLICY_IDS) {
    const v = b[id]
    if (typeof v !== 'string' || !v.trim()) {
      throw new Error(`builtin-policy-bodies: missing or empty ${id}`)
    }
    out[id] = v.trim()
  }
  return out
}

/**
 * Fetches built-in privacy policy bodies from `GET /api/brain-query/builtin-policy-bodies`.
 * Results are cached for the lifetime of the page session.
 */
export async function fetchBrainQueryBuiltinPolicyBodies(): Promise<Record<BrainQueryBuiltinPolicyId, string>> {
  if (cache) return cache
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch('/api/brain-query/builtin-policy-bodies')
      if (!res.ok) {
        throw new Error(`builtin-policy-bodies: HTTP ${res.status}`)
      }
      const parsed = parseBodiesPayload(await res.json())
      cache = parsed
      return parsed
    })()
  }
  return inflight
}
