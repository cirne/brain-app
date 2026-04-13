import { describe, it, expect } from 'vitest'
import { TAB_ORDER, matchGlobalShortcut, type KeyLike } from './globalShortcuts.js'

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

describe('TAB_ORDER', () => {
  it('matches nav: Today, Inbox, Wiki, Calendar', () => {
    expect([...TAB_ORDER]).toEqual(['today', 'inbox', 'wiki', 'calendar'])
  })
})

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

  it('maps ⌘1–⌘4 to tabs', () => {
    expect(matchGlobalShortcut(k({ key: '1', metaKey: true }))).toEqual({ type: 'tab', index: 0 })
    expect(matchGlobalShortcut(k({ key: '2', metaKey: true }))).toEqual({ type: 'tab', index: 1 })
    expect(matchGlobalShortcut(k({ key: '3', metaKey: true }))).toEqual({ type: 'tab', index: 2 })
    expect(matchGlobalShortcut(k({ key: '4', metaKey: true }))).toEqual({ type: 'tab', index: 3 })
  })

  it('maps Ctrl+1–4 to tabs (fallback when ⌘+digit is captured by the browser)', () => {
    expect(matchGlobalShortcut(k({ key: '1', ctrlKey: true }))).toEqual({ type: 'tab', index: 0 })
    expect(matchGlobalShortcut(k({ key: '4', ctrlKey: true }))).toEqual({ type: 'tab', index: 3 })
  })

  it('maps ⌥⌘1–⌥⌘4 to tabs', () => {
    expect(matchGlobalShortcut(k({ key: '1', metaKey: true, altKey: true }))).toEqual({
      type: 'tab',
      index: 0,
    })
    expect(matchGlobalShortcut(k({ key: '3', metaKey: true, altKey: true }))).toEqual({
      type: 'tab',
      index: 2,
    })
  })

  it('does not treat ctrl+meta+digit as tab (ambiguous chord)', () => {
    expect(matchGlobalShortcut(k({ key: '2', metaKey: true, ctrlKey: true }))).toBeNull()
  })

  it('ignores digit shortcuts outside 1–4', () => {
    expect(matchGlobalShortcut(k({ key: '5', metaKey: true }))).toBeNull()
    expect(matchGlobalShortcut(k({ key: '0', ctrlKey: true }))).toBeNull()
  })
})
