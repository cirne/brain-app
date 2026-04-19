import { describe, expect, it } from 'vitest'
import { buildIndexingElapsedLine } from './onboardingIndexingUi.js'

describe('buildIndexingElapsedLine', () => {
  const t0 = 1_000_000_000_000

  it('returns null when not indexing or no start time', () => {
    expect(buildIndexingElapsedLine('indexing', null, t0)).toBeNull()
    expect(buildIndexingElapsedLine('not-started', t0, t0 + 120_000)).toBeNull()
  })

  it('returns null under 2 minutes elapsed', () => {
    expect(buildIndexingElapsedLine('indexing', t0, t0 + 119_000)).toBeNull()
  })

  it('returns short reassurance between 2 and 5 minutes', () => {
    const line = buildIndexingElapsedLine('indexing', t0, t0 + 3 * 60_000)
    expect(line).toContain('Still working')
  })

  it('returns long message at 5+ minutes with minute count', () => {
    const line = buildIndexingElapsedLine('indexing', t0, t0 + 7 * 60_000)
    expect(line).toContain('7 minutes')
  })
})
