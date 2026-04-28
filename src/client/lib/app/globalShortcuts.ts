/** Minimal keyboard event shape for tests and `matchGlobalShortcut`. */
export type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat'>

export type GlobalShortcutAction =
  | { type: 'search' }
  | { type: 'newChat' }
  | { type: 'refresh' }
  | { type: 'wikiHome' }

/**
 * Maps low-level chords to app actions. Does not call `preventDefault`.
 *
 * - ⌘K / Ctrl+K — search
 * - ⌘N / Ctrl+N — new chat
 * - ⌘R / Ctrl+R — sync (refresh)
 * - ⌘⇧H / Ctrl+Shift+H — wiki home (same as top-nav wiki control)
 *
 * Note: In Google Chrome, many ⌘ shortcuts are reserved for the browser UI; the page may
 * never receive keydown for them. The packaged app (Tauri) or a different browser profile
 * can behave differently. Assistant registers the listener in capture phase to run early.
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

  if (k === 'h' && e.shiftKey) {
    return { type: 'wikiHome' }
  }

  return null
}
