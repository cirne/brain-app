import { describe, expect, it } from 'vitest'
import { easeOutCubic } from './easing.js'

describe('easeOutCubic', () => {
  it('maps endpoints', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })

  it('clamps outside 0–1', () => {
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
  })

  it('eases out (midpoint above linear)', () => {
    const mid = easeOutCubic(0.5)
    expect(mid).toBeGreaterThan(0.5)
    expect(mid).toBeLessThan(1)
  })
})
