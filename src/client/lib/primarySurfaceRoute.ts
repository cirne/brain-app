import type { Overlay, Route, RouteZone } from '@client/router.js'

/** Primary surfaces that use one full-width column (no `AgentChat | detail` split). */
export const FULL_WIDTH_PRIMARY_ZONES: ReadonlySet<RouteZone> = new Set(['wiki', 'inbox', 'library', 'tunnels'])

export function routeUsesFullWidthPrimaryWorkspace(route: Pick<Route, 'zone'>): boolean {
  const z = route.zone
  return z != null && FULL_WIDTH_PRIMARY_ZONES.has(z)
}

/**
 * Map a detail overlay to a full-width primary route (`/wiki/…`, `/inbox`, `/library`).
 */
export function primarySurfaceRouteForOverlay(overlay: Overlay): Pick<Route, 'zone' | 'overlay'> | null {
  switch (overlay.type) {
    case 'email':
      return { zone: 'inbox', overlay }
    case 'indexed-file':
      return overlay.id ? { zone: 'library', overlay } : null
    default:
      return null
  }
}
