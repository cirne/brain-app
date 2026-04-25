import { describe, expect, it } from 'vitest'
import { isAllowedBundledNativeClientIp } from './bundledNativeClientAllowlist.js'

describe('isAllowedBundledNativeClientIp', () => {
  it('allows IPv4 loopback', () => {
    expect(isAllowedBundledNativeClientIp('127.0.0.1')).toBe(true)
    expect(isAllowedBundledNativeClientIp('127.8.9.1')).toBe(true)
  })

  it('allows IPv4-mapped IPv6 loopback', () => {
    expect(isAllowedBundledNativeClientIp('::ffff:127.0.0.1')).toBe(true)
  })

  it('allows IPv6 loopback', () => {
    expect(isAllowedBundledNativeClientIp('::1')).toBe(true)
  })

  it('allows RFC 6598 CGNAT (Tailscale node range 100.64.0.0/10)', () => {
    expect(isAllowedBundledNativeClientIp('100.64.0.1')).toBe(true)
    expect(isAllowedBundledNativeClientIp('100.100.101.94')).toBe(true)
    expect(isAllowedBundledNativeClientIp('100.127.255.255')).toBe(true)
  })

  it('rejects below and above CGNAT band', () => {
    expect(isAllowedBundledNativeClientIp('100.63.255.255')).toBe(false)
    expect(isAllowedBundledNativeClientIp('100.128.0.1')).toBe(false)
  })

  it('rejects typical LAN addresses', () => {
    expect(isAllowedBundledNativeClientIp('192.168.1.1')).toBe(false)
    expect(isAllowedBundledNativeClientIp('10.0.0.1')).toBe(false)
  })

  it('rejects undefined or empty', () => {
    expect(isAllowedBundledNativeClientIp(undefined)).toBe(false)
    expect(isAllowedBundledNativeClientIp('')).toBe(false)
  })
})
