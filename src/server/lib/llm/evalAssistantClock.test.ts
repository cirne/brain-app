import { describe, it, expect, afterEach } from 'vitest'
import { resolveEvalAnchoredNow } from './evalAssistantClock.js'

describe('resolveEvalAnchoredNow', () => {
  afterEach(() => {
    delete process.env.EVAL_ASSISTANT_NOW
  })

  it('returns null when unset', () => {
    expect(resolveEvalAnchoredNow()).toBeNull()
  })

  it('parses YYYY-MM-DD to a stable UTC instant', () => {
    process.env.EVAL_ASSISTANT_NOW = '2002-01-01'
    const d = resolveEvalAnchoredNow()!
    expect(d.getUTCFullYear()).toBe(2002)
    expect(d.getUTCMonth()).toBe(0)
    expect(d.getUTCDate()).toBe(1)
  })

  it('parses ISO8601 strings', () => {
    process.env.EVAL_ASSISTANT_NOW = '2001-06-15T00:00:00.000Z'
    expect(resolveEvalAnchoredNow()!.toISOString()).toContain('2001-06-15')
  })
})
