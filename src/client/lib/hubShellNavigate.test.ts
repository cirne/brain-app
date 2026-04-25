import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Route } from '../router.js'
import { applyHubDetailNavigation } from './hubShellNavigate.js'

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
      { overlay: { type: 'wiki', path: 'a.md' }, hubActive: true },
      undefined,
    )
  })

  it('passes hubActive false when opening doc on chat column', () => {
    const route: Route = {}
    applyHubDetailNavigation(route, { type: 'wiki', path: 'a.md' }, undefined, false)
    expect(vi.mocked(navigate)).toHaveBeenCalledWith(
      { overlay: { type: 'wiki', path: 'a.md' }, hubActive: false },
      undefined,
    )
  })
})
