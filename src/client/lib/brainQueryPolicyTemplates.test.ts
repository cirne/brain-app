import { describe, expect, it } from 'vitest'
import { getBuiltinPolicyBodiesFromDisk } from '@server/lib/brainQuery/builtinPolicyBodiesFromDisk.js'
import { translateClient } from '@client/lib/i18n/index.js'
import {
  BRAIN_QUERY_GRANT_POLICY_TEMPLATE_META,
  buildBrainQueryGrantPolicyTemplates,
  isBrainQueryBuiltinTemplateId,
  templateById,
} from './brainQueryPolicyTemplates.js'

describe('brain query policy templates', () => {
  const bodies = getBuiltinPolicyBodiesFromDisk()
  const grantTemplates = buildBrainQueryGrantPolicyTemplates(bodies)

  it('exports exactly three grantable built-in preset meta rows (no server-default row)', () => {
    const ids = BRAIN_QUERY_GRANT_POLICY_TEMPLATE_META.map((t) => t.id)
    expect(ids).toEqual(['trusted', 'general', 'minimal-disclosure'])
  })

  it('merged templates have non-empty i18n keys and policy text', () => {
    for (const t of grantTemplates) {
      expect(t.labelKey.length).toBeGreaterThan(0)
      expect(t.hintKey.length).toBeGreaterThan(0)
      expect(translateClient(t.labelKey).length).toBeGreaterThan(0)
      expect(translateClient(t.hintKey).length).toBeGreaterThan(0)
      expect(t.text.trim().length).toBeGreaterThan(40)
    }
  })

  it('templates avoid plumbing terms like cross-brain sync tools or tool', () => {
    for (const t of grantTemplates) {
      const resolved = `${translateClient(t.labelKey)} ${translateClient(t.hintKey)}`
      const allText = `${resolved} ${t.text}`.toLowerCase()
      expect(allText).not.toContain('ask_' + 'brain')
      expect(allText).not.toContain('tool call')
    }
  })

  it('templateById returns matching template for grant presets', () => {
    expect(translateClient(templateById(bodies, 'trusted')!.labelKey)).toMatch(/trusted/i)
    expect(templateById(bodies, 'general')?.id).toBe('general')
    expect(templateById(bodies, 'minimal-disclosure')?.id).toBe('minimal-disclosure')
  })

  it('templateById still resolves server-default baseline prose (not in grant template list)', () => {
    const t = templateById(bodies, 'server-default')
    expect(t?.id).toBe('server-default')
    expect(t?.text.trim().length).toBeGreaterThan(40)
  })

  it('isBrainQueryBuiltinTemplateId is true only for the three grant preset ids', () => {
    expect(isBrainQueryBuiltinTemplateId('trusted')).toBe(true)
    expect(isBrainQueryBuiltinTemplateId('general')).toBe(true)
    expect(isBrainQueryBuiltinTemplateId('minimal-disclosure')).toBe(true)
    expect(isBrainQueryBuiltinTemplateId('server-default')).toBe(false)
  })
})
