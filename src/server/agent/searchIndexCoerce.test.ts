import { describe, expect, it } from 'vitest'
import { coerceSearchIndexInlineOperators, mergeSearchIndexStdoutHints } from './searchIndexCoerce.js'

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
