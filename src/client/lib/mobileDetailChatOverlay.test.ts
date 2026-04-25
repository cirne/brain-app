import { describe, expect, it } from 'vitest'
import { overlaySupportsMobileChatBridge } from './mobileDetailChatOverlay.js'

describe('overlaySupportsMobileChatBridge', () => {
  it('returns true for wiki, file, wiki-dir', () => {
    expect(overlaySupportsMobileChatBridge({ type: 'wiki', path: 'a.md' })).toBe(true)
    expect(overlaySupportsMobileChatBridge({ type: 'wiki' })).toBe(true)
    expect(overlaySupportsMobileChatBridge({ type: 'file', path: '/x' })).toBe(true)
    expect(overlaySupportsMobileChatBridge({ type: 'wiki-dir', path: 'notes' })).toBe(true)
  })

  it('returns true for email only when thread id is set', () => {
    expect(overlaySupportsMobileChatBridge({ type: 'email', id: 't1' })).toBe(true)
    expect(overlaySupportsMobileChatBridge({ type: 'email' })).toBe(false)
    expect(overlaySupportsMobileChatBridge({ type: 'email', id: '' })).toBe(false)
  })

  it('returns false for non-doc overlays', () => {
    expect(overlaySupportsMobileChatBridge({ type: 'calendar', date: '2026-01-01' })).toBe(false)
    expect(overlaySupportsMobileChatBridge({ type: 'messages', chat: 'x' })).toBe(false)
    expect(overlaySupportsMobileChatBridge({ type: 'hub' })).toBe(false)
    expect(overlaySupportsMobileChatBridge(undefined)).toBe(false)
  })
})
