import { describe, it, expect } from 'vitest'
import {
  nativeAppPortCandidates,
  nativeAppOAuthPortCandidates,
  NATIVE_APP_PORT_END,
  NATIVE_APP_PORT_START,
  NATIVE_APP_PORT_FAILOVER_COUNT,
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

describe('nativeAppOAuthPortCandidates', () => {
  it('starts at NATIVE_APP_PORT_START', () => {
    const v = nativeAppOAuthPortCandidates()
    expect(v[0]).toBe(NATIVE_APP_PORT_START)
  })

  it('has exactly NATIVE_APP_PORT_FAILOVER_COUNT + 1 entries', () => {
    const v = nativeAppOAuthPortCandidates()
    expect(v.length).toBe(NATIVE_APP_PORT_FAILOVER_COUNT + 1)
  })

  it('is a prefix of nativeAppPortCandidates()', () => {
    const all = nativeAppPortCandidates()
    const oauth = nativeAppOAuthPortCandidates()
    expect(oauth).toEqual(all.slice(0, oauth.length))
  })

  it('contains no IANA-reserved ports (18516)', () => {
    expect(nativeAppOAuthPortCandidates()).not.toContain(18516)
  })

  it('NATIVE_APP_PORT_FAILOVER_COUNT is 3 (4 total: primary + 3 failovers)', () => {
    expect(NATIVE_APP_PORT_FAILOVER_COUNT).toBe(3)
  })
})
