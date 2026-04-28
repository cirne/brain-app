import { describe, it, expect } from 'vitest'
import { matchSessionIdByFlatPrefix } from './chatSessionTailResolve.js'

describe('matchSessionIdByFlatPrefix', () => {
  it('returns the first session whose uuid hex starts with the tail', () => {
    const a = '20e4c147-15c2-4ba8-8c1f-701299c53dd2'
    const b = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    expect(matchSessionIdByFlatPrefix('20e4c14715c2', [b, a])).toBe(a)
    expect(matchSessionIdByFlatPrefix('20e4c14715c2', [a, b])).toBe(a)
  })

  it('ignores non-uuid session ids', () => {
    expect(matchSessionIdByFlatPrefix('20e4c14715c2', ['not-a-uuid', 'sess-1'])).toBeUndefined()
  })
})
