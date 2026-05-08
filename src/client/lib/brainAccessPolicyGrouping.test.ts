import { describe, expect, it } from 'vitest'
import { templateById } from './brainQueryPolicyTemplates.js'
import type { BrainAccessCustomPolicy } from './brainAccessCustomPolicies.js'
import {
  buildPolicyCardModels,
  classifyGrantPolicy,
  grantsMatchingPolicyId,
  normalizePolicyText,
  ownerLogEntriesForPolicy,
} from './brainAccessPolicyGrouping.js'

const trustedText = templateById('trusted')!.text

describe('brainAccessPolicyGrouping', () => {
  const custom: BrainAccessCustomPolicy[] = [
    { id: 'custom:x', name: 'Legal', text: 'Only legal matters.', colorIndex: 0 },
  ]

  it('classifyGrantPolicy matches built-in template text', () => {
    const c = classifyGrantPolicy(trustedText, [])
    expect(c.policyId).toBe('trusted')
    expect(c.kind).toBe('builtin')
  })

  it('classifyGrantPolicy matches custom saved policy', () => {
    const c = classifyGrantPolicy('Only legal matters.', custom)
    expect(c.policyId).toBe('custom:x')
    expect(c.kind).toBe('custom')
  })

  it('classifyGrantPolicy buckets unknown text as adhoc', () => {
    const c = classifyGrantPolicy('Totally unique policy prose.', [])
    expect(c.kind).toBe('adhoc')
    expect(c.policyId.startsWith('adhoc:')).toBe(true)
  })

  it('normalizePolicyText trims and normalizes newlines', () => {
    expect(normalizePolicyText('  a\r\nb  ')).toBe('a\nb')
  })

  it('buildPolicyCardModels orders builtin, custom, then adhoc', () => {
    const generalText = templateById('general')!.text
    const grants = [
      {
        id: 'g1',
        ownerId: 'o',
        ownerHandle: 'me',
        askerId: 'a1',
        askerHandle: 'u1',
        privacyPolicy: trustedText,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        id: 'g2',
        ownerId: 'o',
        ownerHandle: 'me',
        askerId: 'a2',
        askerHandle: 'u2',
        privacyPolicy: generalText,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        id: 'g3',
        ownerId: 'o',
        ownerHandle: 'me',
        askerId: 'a3',
        askerHandle: 'u3',
        privacyPolicy: 'Only legal matters.',
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      {
        id: 'g4',
        ownerId: 'o',
        ownerHandle: 'me',
        askerId: 'a4',
        askerHandle: 'u4',
        privacyPolicy: 'orphan text',
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]
    const cards = buildPolicyCardModels(grants, custom)
    const ids = cards.map((c) => c.policyId)
    expect(ids.slice(0, 3)).toEqual(['trusted', 'general', 'minimal-disclosure'])
    expect(ids).toContain('custom:x')
    expect(ids.some((x) => x.startsWith('adhoc:'))).toBe(true)
  })

  it('ownerLogEntriesForPolicy filters by askers in policy grants', () => {
    const grants = [
      {
        id: 'g1',
        ownerId: 'o',
        ownerHandle: 'me',
        askerId: 'usr_a',
        privacyPolicy: trustedText,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]
    const log = [
      {
        id: 'l1',
        ownerId: 'o',
        askerId: 'usr_a',
        question: 'q1',
        finalAnswer: null,
        filterNotes: null,
        status: 'ok',
        createdAtMs: 100,
        durationMs: null,
      },
      {
        id: 'l2',
        ownerId: 'o',
        askerId: 'usr_b',
        question: 'q2',
        finalAnswer: null,
        filterNotes: null,
        status: 'ok',
        createdAtMs: 101,
        durationMs: null,
      },
    ]
    const filtered = ownerLogEntriesForPolicy(log, grants, [], 'trusted')
    expect(filtered.map((x) => x.id)).toEqual(['l1'])
  })

  it('grantsMatchingPolicyId lists grants for a policy bucket', () => {
    const grants = [
      {
        id: 'g1',
        ownerId: 'o',
        ownerHandle: 'me',
        askerId: 'x',
        privacyPolicy: trustedText,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    ]
    expect(grantsMatchingPolicyId(grants, [], 'trusted')).toHaveLength(1)
    expect(grantsMatchingPolicyId(grants, [], 'general')).toHaveLength(0)
  })
})
