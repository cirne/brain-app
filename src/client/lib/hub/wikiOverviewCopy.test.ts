import { describe, expect, it } from 'vitest'
import type { BackgroundAgentDoc } from '@client/lib/statusBar/backgroundAgentTypes.js'
import { wikiOverviewSubtitle, wikiOverviewTitle } from './wikiOverviewCopy.js'

function doc(partial: Partial<BackgroundAgentDoc>): BackgroundAgentDoc {
  return {
    id: 'your-wiki',
    kind: 'your-wiki',
    status: 'running',
    label: 'Your Wiki',
    detail: '',
    pageCount: 0,
    logLines: [],
    startedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('wikiOverviewTitle', () => {
  it('defaults when doc is null', () => {
    expect(wikiOverviewTitle(null)).toBe('Your Wiki')
  })

  it('maps idle pause-between-laps detail', () => {
    expect(wikiOverviewTitle(doc({ phase: 'idle', detail: 'Pausing between laps' }))).toBe(
      'Taking a short break',
    )
  })
})

describe('wikiOverviewSubtitle', () => {
  it('shows loading when doc is null', () => {
    expect(wikiOverviewSubtitle(null, null)).toBe('Loading status…')
  })

  it('truncates long error messages', () => {
    const long = 'x'.repeat(200)
    const sub = wikiOverviewSubtitle(doc({ phase: 'error', error: long }), null)
    expect(sub.endsWith('…')).toBe(true)
    expect(sub.length).toBeLessThanOrEqual(140)
  })
})
