import { describe, expect, it } from 'vitest'
import {
  overlaySuppressesWorkspaceSplitDetail,
  routeShowsWorkspaceSplitDetail,
} from './settingsWorkspaceSplit.js'

describe('settingsWorkspaceSplit', () => {
  it('suppresses split detail for settings drill-ins and brain-access stack', () => {
    expect(overlaySuppressesWorkspaceSplitDetail({ type: 'settings-wiki' })).toBe(true)
    expect(overlaySuppressesWorkspaceSplitDetail({ type: 'brain-access' })).toBe(true)
    expect(overlaySuppressesWorkspaceSplitDetail({ type: 'hub' })).toBe(true)
  })

  it('allows split detail for typical chat slide overlays', () => {
    expect(overlaySuppressesWorkspaceSplitDetail({ type: 'wiki', path: 'a.md' })).toBe(false)
    expect(overlaySuppressesWorkspaceSplitDetail({ type: 'email', id: 'x' })).toBe(false)
  })

  it('routeShowsWorkspaceSplitDetail respects wiki zone', () => {
    expect(
      routeShowsWorkspaceSplitDetail({
        zone: 'wiki',
        overlay: { type: 'wiki', path: 'a.md' },
      }),
    ).toBe(false)
    expect(
      routeShowsWorkspaceSplitDetail({
        overlay: { type: 'wiki', path: 'a.md' },
      }),
    ).toBe(true)
  })

  it('returns false without overlay', () => {
    expect(routeShowsWorkspaceSplitDetail({ overlay: undefined })).toBe(false)
  })
})
