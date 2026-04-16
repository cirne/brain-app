import { describe, it, expect } from 'vitest'
import { enrichAppleMailSetupError } from './appleMailSetupHints.js'

describe('enrichAppleMailSetupError', () => {
  it('passes through unrelated errors', () => {
    expect(enrichAppleMailSetupError('network down')).toBe('network down')
  })

  it('appends FDA hint when ripmail mentions Full Disk Access', () => {
    const out = enrichAppleMailSetupError(
      'grant Full Disk Access to this terminal app',
    )
    expect(out).toContain('Ensure **Brain** is listed')
    expect(out).toContain('greyed out')
  })

  it('appends hint for could not find Apple Mail', () => {
    const out = enrichAppleMailSetupError('Could not find Apple Mail under /Users/x/Library/Mail')
    expect(out).toContain('Ensure **Brain** is listed')
  })

  it('does not double-append if already enriched', () => {
    const once = enrichAppleMailSetupError('Could not find Apple Mail')
    const twice = enrichAppleMailSetupError(once)
    expect(twice).toBe(once)
  })
})
