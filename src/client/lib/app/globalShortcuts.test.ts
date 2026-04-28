import { describe, it, expect } from 'vitest'
import { matchGlobalShortcut, type KeyLike } from './globalShortcuts.js'

function k(p: Partial<KeyLike> & Pick<KeyLike, 'key'>): KeyLike {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...p,
  }
}

describe('matchGlobalShortcut', () => {
  it('returns null without modifiers', () => {
    expect(matchGlobalShortcut(k({ key: 'k' }))).toBeNull()
    expect(matchGlobalShortcut(k({ key: '1' }))).toBeNull()
  })

  it('returns null on key repeat', () => {
    expect(matchGlobalShortcut(k({ key: 'k', metaKey: true, repeat: true }))).toBeNull()
  })

  it('maps ⌘K / Ctrl+K to search', () => {
    expect(matchGlobalShortcut(k({ key: 'k', metaKey: true }))).toEqual({ type: 'search' })
    expect(matchGlobalShortcut(k({ key: 'K', metaKey: true }))).toEqual({ type: 'search' })
    expect(matchGlobalShortcut(k({ key: 'k', ctrlKey: true }))).toEqual({ type: 'search' })
  })

  it('maps ⌘N / Ctrl+N to newChat', () => {
    expect(matchGlobalShortcut(k({ key: 'n', metaKey: true }))).toEqual({ type: 'newChat' })
    expect(matchGlobalShortcut(k({ key: 'n', ctrlKey: true }))).toEqual({ type: 'newChat' })
  })

  it('maps ⌘R / Ctrl+R to refresh but not shift-modified reload chord', () => {
    expect(matchGlobalShortcut(k({ key: 'r', metaKey: true }))).toEqual({ type: 'refresh' })
    expect(matchGlobalShortcut(k({ key: 'r', ctrlKey: true }))).toEqual({ type: 'refresh' })
    expect(
      matchGlobalShortcut(k({ key: 'r', metaKey: true, shiftKey: true })),
    ).toBeNull()
  })

  it('maps ⌘⇧H / Ctrl+Shift+H to wikiHome', () => {
    expect(matchGlobalShortcut(k({ key: 'h', metaKey: true, shiftKey: true }))).toEqual({
      type: 'wikiHome',
    })
    expect(matchGlobalShortcut(k({ key: 'H', metaKey: true, shiftKey: true }))).toEqual({
      type: 'wikiHome',
    })
    expect(matchGlobalShortcut(k({ key: 'h', ctrlKey: true, shiftKey: true }))).toEqual({
      type: 'wikiHome',
    })
  })

  it('does not map digit keys to actions', () => {
    expect(matchGlobalShortcut(k({ key: '1', metaKey: true }))).toBeNull()
    expect(matchGlobalShortcut(k({ key: '4', ctrlKey: true }))).toBeNull()
    expect(matchGlobalShortcut(k({ key: '2', metaKey: true, altKey: true }))).toBeNull()
  })
})
