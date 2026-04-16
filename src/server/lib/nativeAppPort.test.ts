import { describe, it, expect } from 'vitest'
import {
  nativeAppPortCandidates,
  NATIVE_APP_PORT_END,
  NATIVE_APP_PORT_START,
} from './nativeAppPort.js'

describe('nativeAppPortCandidates', () => {
  it('covers the range with a single skip (IANA TCP 18516)', () => {
    const v = nativeAppPortCandidates()
    expect(v[0]).toBe(NATIVE_APP_PORT_START)
    expect(v[v.length - 1]).toBe(NATIVE_APP_PORT_END)
    expect(v).not.toContain(18516)
    expect(v.length).toBe(49)
  })

  it('is strictly increasing', () => {
    const v = nativeAppPortCandidates()
    for (let i = 1; i < v.length; i++) {
      expect(v[i]!).toBeGreaterThan(v[i - 1]!)
    }
  })
})
