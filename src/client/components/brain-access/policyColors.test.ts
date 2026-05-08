import { describe, expect, it } from 'vitest'
import { policyCardTone } from './policyColors.js'

describe('policyCardTone', () => {
  it('maps built-in template ids to stable Tailwind bundles', () => {
    expect(policyCardTone({ kind: 'builtin', builtinId: 'trusted', policyId: 'trusted' }).bar).toContain('purple')
    expect(policyCardTone({ kind: 'builtin', builtinId: 'general', policyId: 'general' }).bar).toContain('blue')
    expect(policyCardTone({ kind: 'builtin', builtinId: 'need-to-know', policyId: 'need-to-know' }).bar).toContain(
      'green',
    )
  })

  it('rotates adhoc colors deterministically by policyId', () => {
    const a = policyCardTone({ kind: 'adhoc', policyId: 'adhoc:abc' })
    const b = policyCardTone({ kind: 'adhoc', policyId: 'adhoc:abc' })
    expect(a.bar).toBe(b.bar)
  })
})
