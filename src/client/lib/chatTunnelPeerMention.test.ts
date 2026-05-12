import { describe, it, expect } from 'vitest'
import { formatTunnelPeerMention } from './chatTunnelPeerMention.js'

describe('formatTunnelPeerMention', () => {
  it('prefixes workspace handle with @', () => {
    expect(formatTunnelPeerMention('demo-ken-lay', 'Ken Lay')).toBe('@demo-ken-lay')
  })

  it('normalizes handle that already includes @', () => {
    expect(formatTunnelPeerMention('@ken', null)).toBe('@ken')
  })

  it('uses display name when handle missing', () => {
    expect(formatTunnelPeerMention(null, 'Ken Lay')).toBe('Ken Lay')
  })

  it('returns empty when neither is usable', () => {
    expect(formatTunnelPeerMention(null, null)).toBe('')
    expect(formatTunnelPeerMention('  ', '  ')).toBe('')
    expect(formatTunnelPeerMention('@', null)).toBe('')
  })
})
