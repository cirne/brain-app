import type { Route } from '../../router.js'

/** Matches top nav order in AppTopNav.svelte */
export const TAB_ORDER = ['today', 'inbox', 'wiki', 'calendar'] as const satisfies readonly Route['tab'][]

export type GlobalShortcutAction =
  | { type: 'search' }
  | { type: 'newChat' }
  | { type: 'refresh' }
  | { type: 'tab'; index: number }

/** Minimal keyboard event shape for tests and `matchGlobalShortcut`. */
export type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat'>

function digitIndex(key: string): number | null {
  if (key >= '1' && key <= '4') return parseInt(key, 10) - 1
  return null
}

/**
 * Maps low-level chords to app actions. Does not call `preventDefault`.
 *
 * Tab switching:
 * - ⌘1–⌘4 (often swallowed by Chrome when multiple browser tabs are open)
 * - ⌃1–⌃4 fallback
 * - ⌥⌘1–⌥⌘4 fallback
 */
export function matchGlobalShortcut(e: KeyLike): GlobalShortcutAction | null {
  if (e.repeat) return null

  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key

  const mod = e.metaKey || e.ctrlKey
  if (!mod) {
    return null
  }

  // ⌘/Ctrl+Shift+R — let the browser hard-reload
  if (e.shiftKey && k === 'r') return null

  if (k === 'k' && !e.shiftKey) {
    return { type: 'search' }
  }

  if (k === 'n' && !e.shiftKey) {
    return { type: 'newChat' }
  }

  if (k === 'r' && !e.shiftKey) {
    return { type: 'refresh' }
  }

  const di = digitIndex(k)
  if (di === null) return null

  const cmdDigit = e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
  const ctrlDigit = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
  const optCmdDigit = e.metaKey && e.altKey && !e.ctrlKey && !e.shiftKey

  if (cmdDigit || ctrlDigit || optCmdDigit) {
    return { type: 'tab', index: di }
  }

  return null
}
