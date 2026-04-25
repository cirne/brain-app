import { describe, expect, it } from 'vitest'
import { yourWikiNarrativeLine, yourWikiPhaseNarrative } from './yourWikiNarrative.js'

describe('yourWikiNarrativeLine', () => {
  it('prefers non-empty server detail over phase copy', () => {
    expect(yourWikiNarrativeLine('starting', '  Live update  ')).toBe('Live update')
  })

  it('falls back to phase narrative when detail is empty', () => {
    expect(yourWikiNarrativeLine('starting', null)).toBe(
      'Building your first wiki pages from your profile and indexed mail…',
    )
    expect(yourWikiNarrativeLine('starting', '   ')).toBe(
      'Building your first wiki pages from your profile and indexed mail…',
    )
  })
})

describe('yourWikiPhaseNarrative', () => {
  it('returns idle copy for idle', () => {
    expect(yourWikiPhaseNarrative('idle')).toContain('Up to date')
  })
})
