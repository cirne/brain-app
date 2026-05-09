import { describe, expect, it } from 'vitest'
import { indexFeedSummaryFromHubSources } from './indexFeedSummary.js'

describe('indexFeedSummaryFromHubSources', () => {
  it('returns empty string for no sources', () => {
    expect(indexFeedSummaryFromHubSources([])).toBe('')
  })

  it('summarizes mail, calendars, and other', () => {
    expect(
      indexFeedSummaryFromHubSources([
        { kind: 'imap' },
        { kind: 'applemail' },
        { kind: 'googleCalendar' },
        { kind: 'localDir' },
        { kind: 'googleDrive' },
      ]),
    ).toBe('2 mailboxes · 1 calendar · 2 folders')
  })
})
