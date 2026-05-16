import { describe, expect, it } from 'vitest'
import type { BackgroundStatusResponse } from '@shared/backgroundStatus.js'
import { buildInitialYourWikiDocFromWikiSlice } from './yourWikiDocFromBackground.js'

describe('buildInitialYourWikiDocFromWikiSlice', () => {
  it('maps wiki slice into BackgroundAgentDoc', () => {
    const wiki: BackgroundStatusResponse['wiki'] = {
      status: 'running',
      phase: 'enriching',
      pageCount: 12,
      currentLap: 2,
      detail: 'Working',
      lastRunAt: '2026-05-01T12:00:00Z',
      autoStartEligible: true,
      error: undefined,
    }
    const d = buildInitialYourWikiDocFromWikiSlice(wiki, '2026-05-01T11:00:00Z')
    expect(d.id).toBe('your-wiki')
    expect(d.phase).toBe('enriching')
    expect(d.pageCount).toBe(12)
    expect(d.startedAt).toBe('2026-05-01T12:00:00Z')
  })
})
