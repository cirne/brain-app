import { describe, expect, it } from 'vitest'
import { compareHubRipmailSources, hubSourceTier, sortHubRipmailSources } from './hubSourceOrdering.js'
import type { HubRipmailSourceRow } from './hubRipmailSource.js'

function row(partial: Partial<HubRipmailSourceRow> & Pick<HubRipmailSourceRow, 'id'>): HubRipmailSourceRow {
  return {
    kind: 'imap',
    displayName: 'A',
    path: null,
    ...partial,
  }
}

describe('hubSourceTier', () => {
  it('orders mail before calendars before folders', () => {
    expect(hubSourceTier('imap')).toBeLessThan(hubSourceTier('googleCalendar'))
    expect(hubSourceTier('googleCalendar')).toBeLessThan(hubSourceTier('localDir'))
    expect(hubSourceTier('localDir')).toBeLessThan(hubSourceTier('unknown'))
  })

  it('groups googleDrive with localDir', () => {
    expect(hubSourceTier('googleDrive')).toBe(hubSourceTier('localDir'))
  })
})

describe('sortHubRipmailSources', () => {
  it('sorts by tier then display name', () => {
    const a = row({ id: 'a', kind: 'imap', displayName: 'Zeta' })
    const b = row({ id: 'b', kind: 'imap', displayName: 'Alpha' })
    const c = row({ id: 'c', kind: 'googleCalendar', displayName: 'Cal' })
    expect(sortHubRipmailSources([c, a, b]).map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('compareHubRipmailSources', () => {
  it('is stable for equal rows', () => {
    const x = row({ id: 'x', displayName: 'Same', kind: 'imap' })
    expect(compareHubRipmailSources(x, { ...x })).toBe(0)
  })
})
