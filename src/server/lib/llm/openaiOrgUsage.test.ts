import { describe, expect, it } from 'vitest'
import {
  parseLlmUsageArgv,
  parseRelativeWindow,
  parseSince,
  parseUntil,
  splitTimeRange,
} from './openaiOrgUsage.js'

describe('openaiOrgUsage', () => {
  it('parseRelativeWindow accepts d, h, w', () => {
    expect(parseRelativeWindow('7d')).toBe(7 * 24 * 60 * 60)
    expect(parseRelativeWindow('24h')).toBe(24 * 60 * 60)
    expect(parseRelativeWindow('2w')).toBe(14 * 24 * 60 * 60)
  })

  it('parseSince defaults to 7d before now', () => {
    const now = 1_700_000_000
    const s = parseSince(undefined, now)
    expect(s).toBe(now - 7 * 24 * 60 * 60)
  })

  it('parseSince accepts YYYY-MM-DD as UTC midnight', () => {
    const s = parseSince('2024-06-01', 1_700_000_000)
    expect(s).toBe(Math.floor(Date.parse('2024-06-01T00:00:00.000Z') / 1000))
  })

  it('parseUntil now and YYYY-MM-DD', () => {
    const now = 1_700_000_000
    expect(parseUntil(undefined, now)).toBe(now)
    expect(parseUntil('now', now)).toBe(now)
    const u = parseUntil('2024-06-01', now)
    expect(u).toBe(Math.floor(Date.parse('2024-06-02T00:00:00.000Z') / 1000))
  })

  it('splitTimeRange chunks by max span', () => {
    const start = 0
    const end = 40 * 24 * 60 * 60
    const chunks = splitTimeRange(start, end, 31 * 24 * 60 * 60)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].chunkEnd - chunks[0].chunkStart).toBe(31 * 24 * 60 * 60)
    expect(chunks[1].chunkEnd - chunks[1].chunkStart).toBe(9 * 24 * 60 * 60)
  })

  it('parseLlmUsageArgv collects flags', () => {
    const o = parseLlmUsageArgv([
      'node',
      'x',
      '--since',
      '30d',
      '--model',
      'gpt-4o-mini',
      '--model',
      'o4-mini',
      '--project',
      'proj_1',
      '--user-id',
      'u1',
      '--json',
    ])
    expect(o.since).toBe('30d')
    expect(o.models).toEqual(['gpt-4o-mini', 'o4-mini'])
    expect(o.projectIds).toEqual(['proj_1'])
    expect(o.userIds).toEqual(['u1'])
    expect(o.json).toBe(true)
  })
})
