import { describe, expect, it } from 'vitest'
import { formatToolArgs } from './formatToolArgs.js'

describe('formatToolArgs', () => {
  it('returns empty string for nullish args', () => {
    expect(formatToolArgs(null)).toBe('')
    expect(formatToolArgs(undefined)).toBe('')
  })

  it('JSON-stringifies plain objects', () => {
    expect(formatToolArgs({ path: 'x.md' })).toBe('{\n  "path": "x.md"\n}')
  })

  it('falls back to String when JSON.stringify throws', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(formatToolArgs(circular)).toBe('[object Object]')
  })
})
