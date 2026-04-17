/**
 * Cursor math for the agent chat textarea (word / line boundaries).
 * Used so Option/Ctrl+Arrow and line-jump shortcuts work reliably in WebViews.
 */

export function prevWordOffset(text: string, pos: number): number {
  if (pos <= 0) return 0
  let i = pos
  while (i > 0 && /\s/.test(text[i - 1]!)) i--
  while (i > 0 && /\S/.test(text[i - 1]!)) i--
  return i
}

export function nextWordOffset(text: string, pos: number): number {
  const len = text.length
  if (pos >= len) return len
  let i = pos
  if (i < len && /\S/.test(text[i]!)) {
    while (i < len && /\S/.test(text[i]!)) i++
  }
  while (i < len && /\s/.test(text[i]!)) i++
  return i
}

export function lineStartOffset(text: string, pos: number): number {
  const before = text.slice(0, pos)
  return before.lastIndexOf('\n') + 1
}

export function lineEndOffset(text: string, pos: number): number {
  const len = text.length
  if (pos >= len) return len
  const idx = text.indexOf('\n', pos)
  return idx === -1 ? len : idx
}

/**
 * Applies standard text-field cursor shortcuts. Returns true if the event was handled.
 *
 * - Option/Alt+Arrow or Ctrl+Arrow — previous/next word
 * - Meta+ArrowLeft/Right — start/end of current line (e.g. ⌘← / ⌘→ on macOS)
 * - Home / End — start/end of current line (when not combined with Ctrl/Meta/Alt)
 *
 * Shift-modified chords are left to the browser so selection extension keeps working.
 */
export function handleTextareaCursorKeys(e: KeyboardEvent, el: HTMLTextAreaElement): boolean {
  // Do not bail on defaultPrevented: another listener (often capture-phase) may have
  // called preventDefault before this handler; we still apply caret moves for our chords.
  if (e.isComposing) return false
  if (el.disabled || el.readOnly) return false
  if (e.shiftKey) return false

  const { key } = e
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') {
    return false
  }

  const text = el.value
  const selStart = el.selectionStart
  const selEnd = el.selectionEnd
  const base =
    key === 'ArrowLeft' || key === 'Home' ? Math.min(selStart, selEnd) : Math.max(selStart, selEnd)

  const wordMod = e.altKey || (e.ctrlKey && !e.metaKey)
  if (wordMod && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    e.preventDefault()
    e.stopPropagation()
    const next = key === 'ArrowLeft' ? prevWordOffset(text, base) : nextWordOffset(text, base)
    el.setSelectionRange(next, next)
    return true
  }

  if (e.metaKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    e.preventDefault()
    e.stopPropagation()
    const next = key === 'ArrowLeft' ? lineStartOffset(text, base) : lineEndOffset(text, base)
    el.setSelectionRange(next, next)
    return true
  }

  if (key === 'Home' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    e.stopPropagation()
    const next = lineStartOffset(text, base)
    el.setSelectionRange(next, next)
    return true
  }

  if (key === 'End' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    e.stopPropagation()
    const next = lineEndOffset(text, base)
    el.setSelectionRange(next, next)
    return true
  }

  return false
}
