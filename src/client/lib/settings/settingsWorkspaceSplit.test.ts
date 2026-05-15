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

  it('routeShowsWorkspaceSplitDetail respects full-width primary zones', () => {
    expect(
      routeShowsWorkspaceSplitDetail({
        zone: 'wiki',
        overlay: { type: 'wiki', path: 'a.md' },
      }),
    ).toBe(false)
    expect(
      routeShowsWorkspaceSplitDetail({
        zone: 'inbox',
        overlay: { type: 'email', id: 'm1' },
      }),
    ).toBe(false)
    expect(
      routeShowsWorkspaceSplitDetail({
        zone: 'library',
        overlay: { type: 'indexed-file', id: 'f1' },
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
