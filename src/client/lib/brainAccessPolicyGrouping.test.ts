import { describe, expect, it } from 'vitest'
import { getBuiltinPolicyBodiesFromDisk } from '@server/lib/brainQuery/builtinPolicyBodiesFromDisk.js'
import { templateById } from './brainQueryPolicyTemplates.js'
import type { BrainAccessCustomPolicy } from './brainAccessCustomPolicies.js'
import { translateClient } from '@client/lib/i18n/index.js'
import {
  buildPolicyCardModels,
  buildPolicyPickerOptions,
  policyPickerOptionToCardModel,
  classifyGrantPolicy,
  grantsMatchingPolicyId,
  normalizePolicyText,
} from './brainAccessPolicyGrouping.js'

const bodies = getBuiltinPolicyBodiesFromDisk()
const trustedText = templateById(bodies, 'trusted')!.text

describe('brainAccessPolicyGrouping', () => {
  const custom: BrainAccessCustomPolicy[] = [
    { id: 'custom:x', name: 'Legal', text: 'Only legal matters.', colorIndex: 0 },
  ]

  it('classifyGrantPolicy matches built-in template text', () => {
    const c = classifyGrantPolicy({ privacyPolicy: trustedText }, [], bodies)
    expect(c.policyId).toBe('trusted')
    expect(c.kind).toBe('builtin')
  })

  it('classifyGrantPolicy matches custom saved policy', () => {
    const c = classifyGrantPolicy({ privacyPolicy: 'Only legal matters.' }, custom, bodies)
    expect(c.policyId).toBe('custom:x')
    expect(c.kind).toBe('custom')
  })

  it('classifyGrantPolicy buckets unknown text as adhoc', () => {
    const c = classifyGrantPolicy({ privacyPolicy: 'Totally unique policy prose.' }, [], bodies)
    expect(c.kind).toBe('adhoc')
    expect(c.policyId.startsWith('adhoc:')).toBe(true)
  })

  it('normalizePolicyText trims and normalizes newlines', () => {
    expect(normalizePolicyText('  a\r\nb  ')).toBe('a\nb')
  })

  it('buildPolicyCardModels orders builtin, custom, then adhoc', () => {
    const generalText = templateById(bodies, 'general')!.text
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
    const cards = buildPolicyCardModels(grants, custom, bodies)
    const ids = cards.map((c) => c.policyId)
    expect(ids.slice(0, 3)).toEqual(['trusted', 'general', 'minimal-disclosure'])
    expect(ids).not.toContain('server-default')
    expect(ids).toContain('custom:x')
    expect(ids.some((x) => x.startsWith('adhoc:'))).toBe(true)
  })

  it('policyPickerOptionToCardModel maps picker rows for PolicyCard select', () => {
    const opts = buildPolicyPickerOptions(custom, bodies)
    const card = policyPickerOptionToCardModel(opts[0]!)
    expect(card.policyId).toBe('trusted')
    expect(card.grants).toEqual([])
    expect(card.hint).toBe(translateClient('access.policyPresets.trusted.hint'))
  })

  it('buildPolicyPickerOptions uses preset hints for built-ins, not custom policy body', () => {
    const opts = buildPolicyPickerOptions(custom, bodies)
    const trusted = opts.find((o) => o.policyId === 'trusted')!
    const legal = opts.find((o) => o.policyId === 'custom:x')!
    expect(trusted.hint).toBe(translateClient('access.policyPresets.trusted.hint'))
    expect(trusted.hint).not.toBe(trustedText)
    expect(legal.hint).toBeUndefined()
    expect(legal.label).toBe('Legal')
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
    expect(grantsMatchingPolicyId(grants, [], 'trusted', bodies)).toHaveLength(1)
    expect(grantsMatchingPolicyId(grants, [], 'general', bodies)).toHaveLength(0)
  })
})
