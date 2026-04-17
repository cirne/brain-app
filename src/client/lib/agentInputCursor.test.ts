import { describe, it, expect, vi } from 'vitest'
import {
  prevWordOffset,
  nextWordOffset,
  lineStartOffset,
  lineEndOffset,
  handleTextareaCursorKeys,
} from './agentInputCursor.js'

describe('prevWordOffset', () => {
  it('returns 0 at start', () => {
    expect(prevWordOffset('hello', 0)).toBe(0)
  })

  it('moves to start of previous word from end', () => {
    expect(prevWordOffset('hello world', 11)).toBe(6)
  })

  it('skips spaces then jumps to previous word', () => {
    expect(prevWordOffset('hello  world', 12)).toBe(7)
  })

  it('handles leading spaces before cursor', () => {
    expect(prevWordOffset('hello |', 6)).toBe(0)
  })
})

describe('nextWordOffset', () => {
  it('returns len at end', () => {
    expect(nextWordOffset('hi', 2)).toBe(2)
  })

  it('moves past word and following spaces', () => {
    expect(nextWordOffset('hello world', 0)).toBe(6)
  })

  it('from run of spaces moves to start of next word', () => {
    expect(nextWordOffset('hello  world', 6)).toBe(7)
  })
})

describe('lineStartOffset / lineEndOffset', () => {
  const multi = 'first line\nsecond line'

  it('lineStartOffset finds start of current line', () => {
    expect(lineStartOffset(multi, 0)).toBe(0)
    expect(lineStartOffset(multi, 5)).toBe(0)
    expect(lineStartOffset(multi, 11)).toBe(11)
    expect(lineStartOffset(multi, 20)).toBe(11)
  })

  it('lineEndOffset finds end of line before newline or eof', () => {
    expect(lineEndOffset(multi, 0)).toBe(10)
    expect(lineEndOffset(multi, 3)).toBe(10)
    expect(lineEndOffset(multi, 11)).toBe(22)
  })
})

function makeTextarea(value: string, start: number, end = start) {
  const el = {
    value,
    disabled: false,
    readOnly: false,
    selectionStart: start,
    selectionEnd: end,
    setSelectionRange: vi.fn((s: number, e: number) => {
      el.selectionStart = s
      el.selectionEnd = e
    }),
  }
  return el as unknown as HTMLTextAreaElement
}

function keyEvt(p: Partial<KeyboardEvent> & Pick<KeyboardEvent, 'key'>): KeyboardEvent {
  return {
    defaultPrevented: false,
    isComposing: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...p,
  } as KeyboardEvent
}

describe('handleTextareaCursorKeys', () => {
  it('moves by word with Alt+Arrow', () => {
    const el = makeTextarea('one two', 7)
    const e = keyEvt({ key: 'ArrowLeft', altKey: true })
    expect(handleTextareaCursorKeys(e, el)).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.stopPropagation).toHaveBeenCalled()
    expect(el.selectionStart).toBe(4)
  })

  it('still moves by word when defaultPrevented was set earlier (capture listener)', () => {
    const el = makeTextarea('one two', 7)
    const e = keyEvt({ key: 'ArrowLeft', altKey: true, defaultPrevented: true })
    expect(handleTextareaCursorKeys(e, el)).toBe(true)
    expect(el.selectionStart).toBe(4)
  })

  it('moves by word with Ctrl+Arrow (no meta)', () => {
    const el = makeTextarea('one two', 7)
    const e = keyEvt({ key: 'ArrowLeft', ctrlKey: true })
    expect(handleTextareaCursorKeys(e, el)).toBe(true)
    expect(el.selectionStart).toBe(4)
  })

  it('jumps to line start/end with Meta+Arrow', () => {
    const el = makeTextarea('ab\ncd', 4)
    expect(handleTextareaCursorKeys(keyEvt({ key: 'ArrowLeft', metaKey: true }), el)).toBe(true)
    expect(el.selectionStart).toBe(3)

    const el2 = makeTextarea('ab\ncd', 1)
    expect(handleTextareaCursorKeys(keyEvt({ key: 'ArrowRight', metaKey: true }), el2)).toBe(true)
    expect(el2.selectionStart).toBe(2)
  })

  it('handles Home and End for current line', () => {
    const el = makeTextarea('ab\ncd', 4)
    expect(handleTextareaCursorKeys(keyEvt({ key: 'Home' }), el)).toBe(true)
    expect(el.selectionStart).toBe(3)

    const el2 = makeTextarea('ab\ncd', 4)
    expect(handleTextareaCursorKeys(keyEvt({ key: 'End' }), el2)).toBe(true)
    expect(el2.selectionStart).toBe(5)
  })

  it('does not handle when shift is held', () => {
    const el = makeTextarea('one two', 7)
    const e = keyEvt({ key: 'ArrowLeft', altKey: true, shiftKey: true })
    expect(handleTextareaCursorKeys(e, el)).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('does not handle when composing', () => {
    const el = makeTextarea('one', 1)
    const e = keyEvt({ key: 'ArrowLeft', altKey: true, isComposing: true })
    expect(handleTextareaCursorKeys(e, el)).toBe(false)
  })

  it('returns false for disabled textarea', () => {
    const el = makeTextarea('x', 1)
    el.disabled = true
    expect(handleTextareaCursorKeys(keyEvt({ key: 'Home' }), el)).toBe(false)
  })

  it('collapses selection to min/max before word move', () => {
    const el = makeTextarea('aa bb', 5, 2)
    expect(handleTextareaCursorKeys(keyEvt({ key: 'ArrowLeft', altKey: true }), el)).toBe(true)
    expect(el.selectionStart).toBe(0)
  })
})

