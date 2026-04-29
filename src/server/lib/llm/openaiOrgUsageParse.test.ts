import { describe, expect, it } from 'vitest'
import { parseOpenAiJsonText, usageBucketRows } from './openaiOrgUsageParse.js'

describe('openaiOrgUsageParse', () => {
  it('parseOpenAiJsonText rejects malformed JSON', () => {
    const r = parseOpenAiJsonText('not json {')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0)
  })

  it('parseOpenAiJsonText accepts objects', () => {
    const r = parseOpenAiJsonText('{"data":[]}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ data: [] })
  })

  it('usageBucketRows reads result or results', () => {
    expect(usageBucketRows({ result: [{ a: 1 }] })).toEqual([{ a: 1 }])
    expect(usageBucketRows({ results: [{ b: 2 }] })).toEqual([{ b: 2 }])
    expect(usageBucketRows(null)).toEqual([])
  })
})
