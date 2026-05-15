import type { BrainQueryBuiltinPolicyId } from '@shared/brainQueryBuiltinPolicyIds.js'
import { translateClient } from '@client/lib/i18n/index.js'
import type { BrainAccessCustomPolicy } from './brainAccessCustomPolicies.js'
import { buildBrainQueryGrantPolicyTemplates } from './brainQueryPolicyTemplates.js'

/** Grant row from `GET /api/brain-query/grants` (owner view). */
export type BrainAccessGrantRow = {
  id: string
  ownerId: string
  ownerHandle: string
  askerId: string
  askerHandle?: string
  privacyPolicy: string
  presetPolicyKey?: string | null
  customPolicyId?: string | null
  replyMode?: 'auto' | 'review' | 'ignore'
  createdAtMs: number
  updatedAtMs: number
  /** When true, answering side streams tunnel replies immediately (default off = review first). */
  autoSend?: boolean
}

/** Subset for classification when only resolved prose + XOR ids are known (e.g. tunnel timeline). */
export type GrantPolicyClassifySource = Pick<BrainAccessGrantRow, 'privacyPolicy'> &
  Partial<Pick<BrainAccessGrantRow, 'presetPolicyKey' | 'customPolicyId'>>

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

export type GrantPolicyMeta = {
  policyId: string
  kind: 'builtin' | 'custom' | 'adhoc'
  builtinId?: BrainQueryBuiltinPolicyId
  label: string
  hint?: string
  canonicalText: string
}

function grantTemplatesFromBodies(bodies: Record<BrainQueryBuiltinPolicyId, string>) {
  return buildBrainQueryGrantPolicyTemplates(bodies)
}

/** Resolve Hub bucket from server grant fields (preset key, custom policy id, or legacy resolved text). */
export function classifyGrantPolicy(
  grant: GrantPolicyClassifySource,
  customPolicies: BrainAccessCustomPolicy[],
  builtinBodies: Record<BrainQueryBuiltinPolicyId, string>,
): GrantPolicyMeta {
  const grantTemplates = grantTemplatesFromBodies(builtinBodies)
  const serverDefaultText = builtinBodies['server-default']
  const pk = grant.presetPolicyKey?.trim()
  if (pk) {
    if (pk === 'server-default') {
      return {
        policyId: 'server-default',
        kind: 'adhoc',
        label: 'Legacy baseline preset',
        canonicalText: serverDefaultText,
      }
    }
    const t = grantTemplates.find((x) => x.id === pk)
    if (t) {
      return {
        policyId: t.id,
        kind: 'builtin',
        builtinId: t.id,
        label: translateClient(t.labelKey),
        hint: translateClient(t.hintKey),
        canonicalText: t.text,
      }
    }
    return {
      policyId: pk,
      kind: 'adhoc',
      label: 'Preset',
      canonicalText: grant.privacyPolicy.trim(),
    }
  }
  const cid = grant.customPolicyId?.trim()
  if (cid) {
    const c = customPolicies.find((p) => p.id === cid)
    if (c) {
      return {
        policyId: c.id,
        kind: 'custom',
        label: c.name,
        canonicalText: c.text,
      }
    }
    return {
      policyId: cid,
      kind: 'adhoc',
      label: 'Other policy',
      canonicalText: grant.privacyPolicy.trim(),
    }
  }

  const n = normalizePolicyText(grant.privacyPolicy)
  if (n === normalizePolicyText(serverDefaultText)) {
    return {
      policyId: 'server-default',
      kind: 'adhoc',
      label: 'Legacy baseline preset',
      canonicalText: serverDefaultText,
    }
  }
  for (const t of grantTemplates) {
    if (normalizePolicyText(t.text) === n) {
      return {
        policyId: t.id,
        kind: 'builtin',
        builtinId: t.id,
        label: translateClient(t.labelKey),
        hint: translateClient(t.hintKey),
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
    canonicalText: grant.privacyPolicy.trim(),
  }
}

export type PolicyCardModel = {
  policyId: string
  kind: 'builtin' | 'custom' | 'adhoc'
  builtinId?: BrainQueryBuiltinPolicyId
  label: string
  hint?: string
  canonicalText: string
  grants: BrainAccessGrantRow[]
  /** Saved custom policy palette index (custom policies only). */
  colorIndex?: number
}

/**
 * Ordered cards: three built-in grant presets, then saved custom policies (by name), then ad-hoc buckets from grants.
 */
export function buildPolicyCardModels(
  grantedByMe: BrainAccessGrantRow[],
  customPolicies: BrainAccessCustomPolicy[],
  builtinBodies: Record<BrainQueryBuiltinPolicyId, string>,
): PolicyCardModel[] {
  const grantTemplates = grantTemplatesFromBodies(builtinBodies)
  const classified = grantedByMe.map((g) => ({
    grant: g,
    meta: classifyGrantPolicy(g, customPolicies, builtinBodies),
  }))

  const byId = new Map<string, BrainAccessGrantRow[]>()
  for (const { grant, meta } of classified) {
    const list = byId.get(meta.policyId) ?? []
    list.push(grant)
    byId.set(meta.policyId, list)
  }

  const cards: PolicyCardModel[] = []

  for (const t of grantTemplates) {
    cards.push({
      policyId: t.id,
      kind: 'builtin',
      builtinId: t.id,
      label: translateClient(t.labelKey),
      hint: translateClient(t.hintKey),
      canonicalText: t.text,
      grants: [...(byId.get(t.id) ?? [])],
    })
    byId.delete(t.id)
  }
  /** Handshake baseline grants are not shown as their own policy card. */
  byId.delete('server-default')

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
  builtinBodies: Record<BrainQueryBuiltinPolicyId, string>,
): BrainAccessGrantRow[] {
  return grantedByMe.filter(
    (g) => classifyGrantPolicy(g, customPolicies, builtinBodies).policyId === policyId,
  )
}
