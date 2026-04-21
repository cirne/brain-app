import { describe, it, expect } from 'vitest'
import { truncateJsonResult } from './truncateJson.js'

describe('truncateJsonResult', () => {
  it('returns string as-is when within limit', () => {
    const input = JSON.stringify([{ id: 1 }, { id: 2 }])
    expect(truncateJsonResult(input, 10000)).toBe(input)
  })

  it('returns non-JSON plain text with a truncation marker when too long', () => {
    const input = 'A'.repeat(5000)
    const result = truncateJsonResult(input, 100)
    expect(result.length).toBeLessThanOrEqual(100)
    expect(result).toContain('[result truncated to 100 chars')
  })

  it('truncates a JSON array from the middle and keeps valid JSON', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i, title: `Event ${i}` }))
    const input = JSON.stringify(items)
    expect(input.length).toBeGreaterThan(200)

    const result = truncateJsonResult(input, 200)
    expect(result.length).toBeLessThanOrEqual(200)

    const parsed = JSON.parse(result) as Record<string, number>[]
    expect(Array.isArray(parsed)).toBe(true)

    const note = parsed.find((x) => x.__note__)
    expect(note).toBeDefined()
    expect(note!.__removed__).toBeGreaterThan(0)
    expect(note!.__total__).toBe(20)
  })

  it('truncation note correctly accounts for removed items', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, title: `Item number ${i}` }))
    const input = JSON.stringify(items)
    // input is ~230 chars; limit 180 forces truncation
    expect(input.length).toBeGreaterThan(180)
    const result = truncateJsonResult(input, 180)
    expect(result.length).toBeLessThanOrEqual(180)
    const parsed = JSON.parse(result) as unknown[]
    const isTruncationNote = (x: unknown): x is { __note__: string; __removed__: number; __total__: number } =>
      typeof x === 'object' &&
      x !== null &&
      '__removed__' in x &&
      '__total__' in x &&
      typeof (x as { __removed__: unknown }).__removed__ === 'number'
    const note = parsed.find(isTruncationNote)
    const kept = parsed.filter((x) => !isTruncationNote(x))
    expect(note).toBeDefined()
    expect(note!.__removed__ + kept.length).toBe(10)
    expect(note!.__total__).toBe(10)
  })

  it('handles a JSON array that is already small enough even with note overhead', () => {
    const items = [{ id: 1 }]
    const input = JSON.stringify(items)
    const result = truncateJsonResult(input, 10000)
    expect(result).toBe(input)
  })

  it('falls back to plain truncation for non-array JSON objects', () => {
    const input = JSON.stringify({ key: 'A'.repeat(5000) })
    const result = truncateJsonResult(input, 100)
    expect(result.length).toBeLessThanOrEqual(100)
    expect(result).toContain('[result truncated to 100 chars')
  })
})
