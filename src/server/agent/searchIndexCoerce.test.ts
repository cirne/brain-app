import { describe, expect, it } from 'vitest'
import {
  addSearchIndexRecencyHints,
  coerceSearchIndexInlineOperators,
  mergeSearchIndexStdoutHints,
} from './searchIndexCoerce.js'

describe('coerceSearchIndexInlineOperators', () => {
  it('extracts Gmail-style from: from pattern into structured from', () => {
    const r = coerceSearchIndexInlineOperators({ pattern: 'from:alice@x.com hello' })
    expect(r.merged.from).toBe('alice@x.com')
    expect((r.merged.pattern ?? '').trim()).toBe('hello')
    expect(r.notes.length).toBeGreaterThan(0)
  })

  it('separates from:email|regex tail', () => {
    const r = coerceSearchIndexInlineOperators({
      pattern: 'from:steven.kean@enron.com|Steven Kean',
    })
    expect(r.merged.from).toBe('steven.kean@enron.com')
    expect((r.merged.pattern ?? '').trim()).toBe('Steven Kean')
  })

  it('does not overwrite explicit structured from', () => {
    const r = coerceSearchIndexInlineOperators({
      pattern: 'from:other@y.com',
      from: 'pinned@z.com',
    })
    expect(r.merged.from).toBe('pinned@z.com')
  })
})

describe('mergeSearchIndexStdoutHints', () => {
  it('prepends to JSON hints array', () => {
    const out = mergeSearchIndexStdoutHints(JSON.stringify({ results: [], hints: ['a'], totalMatched: 0 }, null, 2), [
      'first',
    ])
    const j = JSON.parse(out) as { hints: string[] }
    expect(j.hints[0]).toBe('first')
    expect(j.hints).toContain('a')
  })
})

describe('addSearchIndexRecencyHints', () => {
  it('adds date range metadata and current-state hint for broad searches spanning time', () => {
    const out = addSearchIndexRecencyHints(
      JSON.stringify({
        totalMatched: 3,
        results: [
          { messageId: 'new', date: '2026-04-28T12:00:00Z' },
          { messageId: 'old', date: '2025-01-01T12:00:00Z' },
        ],
      }),
      { pattern: 'flight departure' },
    )
    const j = JSON.parse(out) as {
      dateRange: { newest: string; oldest: string; spanDays: number }
      hints: string[]
    }
    expect(j.dateRange.newest).toBe('2026-04-28T12:00:00Z')
    expect(j.dateRange.oldest).toBe('2025-01-01T12:00:00Z')
    expect(j.dateRange.spanDays).toBeGreaterThan(400)
    expect(j.hints.join('\n')).toMatch(/newest relevant messages first/i)
    expect(j.hints.join('\n')).toMatch(/older messages as historical context/i)
  })

  it('does not add a recency hint when the caller already bounded dates', () => {
    const stdout = JSON.stringify({
      results: [
        { messageId: 'a', date: '2026-04-28T12:00:00Z' },
        { messageId: 'b', date: '2025-01-01T12:00:00Z' },
      ],
    })
    const out = addSearchIndexRecencyHints(stdout, { pattern: 'flight departure', after: '2026-01-01' })
    const j = JSON.parse(out) as { hints?: string[]; dateRange?: unknown }
    expect(j.hints ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/newest relevant/i)]))
    expect(j.dateRange).toBeUndefined()
  })
})
