import { describe, expect, it } from 'vitest'
import { parseEvalMaxConcurrency } from './llmPreflight.js'

describe('parseEvalMaxConcurrency', () => {
  it('returns default when env is missing or empty', () => {
    expect(parseEvalMaxConcurrency(undefined, 12, 5)).toBe(5)
    expect(parseEvalMaxConcurrency('', 12, 5)).toBe(5)
    expect(parseEvalMaxConcurrency('   ', 12, 5)).toBe(5)
  })

  it('clamps to [1, cap]', () => {
    expect(parseEvalMaxConcurrency('1', 12, 10)).toBe(1)
    expect(parseEvalMaxConcurrency('100', 12, 10)).toBe(10)
    expect(parseEvalMaxConcurrency('0', 12, 10)).toBe(10)
    expect(parseEvalMaxConcurrency('nope', 12, 10)).toBe(10)
  })

  it('uses parsed value when in range', () => {
    expect(parseEvalMaxConcurrency('4', 12, 20)).toBe(4)
  })
})
