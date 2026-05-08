import { describe, expect, it } from 'vitest'
import { BRAIN_QUERY_POLICY_TEMPLATES, templateById } from './brainQueryPolicyTemplates.js'

describe('BRAIN_QUERY_POLICY_TEMPLATES', () => {
  it('exports the three built-in templates (trusted, general, minimal-disclosure)', () => {
    const ids = BRAIN_QUERY_POLICY_TEMPLATES.map((t) => t.id)
    expect(ids).toEqual(['trusted', 'general', 'minimal-disclosure'])
  })

  it('templates have non-empty user-facing copy and policy text', () => {
    for (const t of BRAIN_QUERY_POLICY_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.hint.length).toBeGreaterThan(0)
      expect(t.text.trim().length).toBeGreaterThan(40)
    }
  })

  it('templates avoid plumbing terms like ask_brain or tool', () => {
    for (const t of BRAIN_QUERY_POLICY_TEMPLATES) {
      const allText = `${t.label} ${t.hint} ${t.text}`.toLowerCase()
      expect(allText).not.toContain('ask_brain')
      expect(allText).not.toContain('tool call')
    }
  })

  it('templateById returns matching template', () => {
    expect(templateById('trusted')?.label).toContain('Trusted')
    expect(templateById('general')?.id).toBe('general')
    expect(templateById('minimal-disclosure')?.id).toBe('minimal-disclosure')
  })
})
