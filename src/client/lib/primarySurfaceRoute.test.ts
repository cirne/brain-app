import { describe, expect, it } from 'vitest'
import {
  primarySurfaceRouteForOverlay,
  routeUsesFullWidthPrimaryWorkspace,
} from './primarySurfaceRoute.js'

describe('primarySurfaceRoute', () => {
  it('routeUsesFullWidthPrimaryWorkspace is true for wiki and inbox zones', () => {
    expect(routeUsesFullWidthPrimaryWorkspace({ zone: 'wiki' })).toBe(true)
    expect(routeUsesFullWidthPrimaryWorkspace({ zone: 'inbox' })).toBe(true)
    expect(routeUsesFullWidthPrimaryWorkspace({ zone: 'tunnels' })).toBe(true)
    expect(routeUsesFullWidthPrimaryWorkspace({ zone: 'hub' })).toBe(false)
    expect(routeUsesFullWidthPrimaryWorkspace({})).toBe(false)
  })

  it('primarySurfaceRouteForOverlay maps email to inbox zone', () => {
    expect(primarySurfaceRouteForOverlay({ type: 'email', id: 'tid' })).toEqual({
      zone: 'inbox',
      overlay: { type: 'email', id: 'tid' },
    })
  })

  it('primarySurfaceRouteForOverlay returns null for unsupported overlays', () => {
    expect(primarySurfaceRouteForOverlay({ type: 'wiki', path: 'a.md' })).toBe(null)
    expect(primarySurfaceRouteForOverlay({ type: 'calendar', date: '2026-01-01' })).toBe(null)
  })
})
