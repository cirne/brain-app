import { describe, it, expect } from 'vitest'
import { formatTunnelPeerCloseDialogLabel, formatTunnelPeerMention } from './chatTunnelPeerMention.js'

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

describe('formatTunnelPeerCloseDialogLabel', () => {
  it('combines display name and @handle when both exist', () => {
    expect(formatTunnelPeerCloseDialogLabel('demo-ken-lay', 'Ken Lay')).toBe('Ken Lay @demo-ken-lay')
  })

  it('normalizes handle that already includes @', () => {
    expect(formatTunnelPeerCloseDialogLabel('@demo-ken-lay', 'Ken Lay')).toBe('Ken Lay @demo-ken-lay')
  })

  it('uses @handle only when display name missing', () => {
    expect(formatTunnelPeerCloseDialogLabel('demo-ken-lay', null)).toBe('@demo-ken-lay')
  })

  it('uses display name only when handle missing', () => {
    expect(formatTunnelPeerCloseDialogLabel(null, 'Ken Lay')).toBe('Ken Lay')
  })

  it('returns empty when neither is usable', () => {
    expect(formatTunnelPeerCloseDialogLabel(null, null)).toBe('')
  })
})
