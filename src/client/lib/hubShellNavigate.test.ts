import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Route } from '../router.js'
import { applyHubDetailNavigation, applySettingsDetailNavigation } from './hubShellNavigate.js'

vi.mock('../router.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../router.js')>()
  return {
    ...mod,
    navigate: vi.fn(),
  }
})

import { navigate } from '../router.js'

describe('applyHubDetailNavigation', () => {
  afterEach(() => {
    vi.mocked(navigate).mockReset()
  })

  it('defaults to hubActive true (hub column URL)', () => {
    const route: Route = {}
    applyHubDetailNavigation(route, { type: 'wiki', path: 'a.md' })
    expect(vi.mocked(navigate)).toHaveBeenCalledWith(
      { overlay: { type: 'wiki', path: 'a.md' }, hubActive: true, wikiActive: false, settingsActive: false },
      undefined,
    )
  })

  it('passes hubActive false when opening doc on chat column', () => {
    const route: Route = {}
    applyHubDetailNavigation(route, { type: 'wiki', path: 'a.md' }, undefined, false)
    expect(vi.mocked(navigate)).toHaveBeenCalledWith(
      {
        overlay: { type: 'wiki', path: 'a.md' },
        hubActive: false,
        wikiActive: false,
        settingsActive: false,
        sessionId: undefined,
      },
      undefined,
    )
  })
})

describe('applySettingsDetailNavigation', () => {
  afterEach(() => {
    vi.mocked(navigate).mockReset()
  })

  it('defaults to settings column URL', () => {
    const route: Route = {}
    applySettingsDetailNavigation(route, { type: 'hub-source', id: 'a' })
    expect(vi.mocked(navigate)).toHaveBeenCalledWith(
      {
        overlay: { type: 'hub-source', id: 'a' },
        settingsActive: true,
        hubActive: false,
        wikiActive: false,
      },
      undefined,
    )
  })

  it('passes settingsColumnActive false when opening on chat column', () => {
    const route: Route = {}
    applySettingsDetailNavigation(route, { type: 'wiki', path: 'a.md' }, undefined, false)
    expect(vi.mocked(navigate)).toHaveBeenCalledWith(
      {
        overlay: { type: 'wiki', path: 'a.md' },
        settingsActive: false,
        hubActive: false,
        wikiActive: false,
        sessionId: undefined,
      },
      undefined,
    )
  })
})
