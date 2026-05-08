import type { BrainAccessCustomPolicy } from './brainAccessCustomPolicies.js'
import {
  BRAIN_QUERY_POLICY_TEMPLATES,
  type BrainQueryBuiltInPolicyId,
} from './brainQueryPolicyTemplates.js'

/** Grant row from `GET /api/brain-query/grants` (owner view). */
export type BrainAccessGrantRow = {
  id: string
  ownerId: string
  ownerHandle: string
  askerId: string
  askerHandle?: string
  privacyPolicy: string
  createdAtMs: number
  updatedAtMs: number
}

export type BrainAccessLogRow = {
  id: string
  ownerId: string
  askerId: string
  question: string
  draftAnswer?: string | null
  finalAnswer: string | null
  filterNotes: string | null
  status: string
  createdAtMs: number
  durationMs: number | null
}

export function normalizePolicyText(s: string): string {
  return s.trim().replace(/\r\n/g, '\n')
}

/** Deterministic short hash for grouping edited policies that are not templates. */
export function simpleTextHash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

export function classifyGrantPolicy(
  privacyPolicy: string,
  customPolicies: BrainAccessCustomPolicy[],
): {
  policyId: string
  kind: 'builtin' | 'custom' | 'adhoc'
  builtinId?: BrainQueryBuiltInPolicyId
  label: string
  hint?: string
  canonicalText: string
} {
  const n = normalizePolicyText(privacyPolicy)
  for (const t of BRAIN_QUERY_POLICY_TEMPLATES) {
    if (normalizePolicyText(t.text) === n) {
      return {
        policyId: t.id,
        kind: 'builtin',
        builtinId: t.id,
        label: t.label,
        hint: t.hint,
        canonicalText: t.text,
      }
    }
  }
  for (const c of customPolicies) {
    if (normalizePolicyText(c.text) === n) {
      return {
        policyId: c.id,
        kind: 'custom',
        label: c.name,
        canonicalText: c.text,
      }
    }
  }
  const hash = simpleTextHash(n)
  return {
    policyId: `adhoc:${hash}`,
    kind: 'adhoc',
    label: 'Other policy',
    canonicalText: privacyPolicy.trim(),
  }
}

export type PolicyCardModel = {
  policyId: string
  kind: 'builtin' | 'custom' | 'adhoc'
  builtinId?: BrainQueryBuiltInPolicyId
  label: string
  hint?: string
  canonicalText: string
  grants: BrainAccessGrantRow[]
  /** Saved custom policy palette index (custom policies only). */
  colorIndex?: number
}

/**
 * Ordered cards: three built-ins, then saved custom policies (by name), then remaining ad-hoc buckets from grants.
 */
export function buildPolicyCardModels(
  grantedByMe: BrainAccessGrantRow[],
  customPolicies: BrainAccessCustomPolicy[],
): PolicyCardModel[] {
  const classified = grantedByMe.map((g) => ({
    grant: g,
    meta: classifyGrantPolicy(g.privacyPolicy, customPolicies),
  }))

  const byId = new Map<string, BrainAccessGrantRow[]>()
  for (const { grant, meta } of classified) {
    const list = byId.get(meta.policyId) ?? []
    list.push(grant)
    byId.set(meta.policyId, list)
  }

  const cards: PolicyCardModel[] = []

  for (const t of BRAIN_QUERY_POLICY_TEMPLATES) {
    cards.push({
      policyId: t.id,
      kind: 'builtin',
      builtinId: t.id,
      label: t.label,
      hint: t.hint,
      canonicalText: t.text,
      grants: [...(byId.get(t.id) ?? [])],
    })
    byId.delete(t.id)
  }

  const customsSorted = [...customPolicies].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
  for (const c of customsSorted) {
    cards.push({
      policyId: c.id,
      kind: 'custom',
      label: c.name,
      canonicalText: c.text,
      grants: [...(byId.get(c.id) ?? [])],
      colorIndex: c.colorIndex,
    })
    byId.delete(c.id)
  }

  const adhocSorted = [...byId.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [policyId, grants] of adhocSorted) {
    cards.push({
      policyId,
      kind: 'adhoc',
      label: 'Other policy',
      canonicalText: grants[0]?.privacyPolicy.trim() ?? '',
      grants,
    })
  }

  return cards
}

export function grantsMatchingPolicyId(
  grantedByMe: BrainAccessGrantRow[],
  customPolicies: BrainAccessCustomPolicy[],
  policyId: string,
): BrainAccessGrantRow[] {
  return grantedByMe.filter(
    (g) => classifyGrantPolicy(g.privacyPolicy, customPolicies).policyId === policyId,
  )
}

export function ownerLogEntriesForPolicy(
  logOwner: BrainAccessLogRow[],
  grantedByMe: BrainAccessGrantRow[],
  customPolicies: BrainAccessCustomPolicy[],
  policyId: string,
): BrainAccessLogRow[] {
  const askerIds = new Set(
    grantsMatchingPolicyId(grantedByMe, customPolicies, policyId).map((g) => g.askerId),
  )
  return logOwner.filter((e) => askerIds.has(e.askerId))
}

export function queryCountForAsker(logOwner: BrainAccessLogRow[], askerId: string): number {
  return logOwner.filter((e) => e.askerId === askerId).length
}

export function lastQueryMsForAsker(logOwner: BrainAccessLogRow[], askerId: string): number | null {
  let max: number | null = null
  for (const e of logOwner) {
    if (e.askerId !== askerId) continue
    if (max === null || e.createdAtMs > max) max = e.createdAtMs
  }
  return max
}
