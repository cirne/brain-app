import type { Overlay, Route, RouteZone } from '@client/router.js'

/** Primary surfaces that use one full-width column (no `AgentChat | detail` split). */
export const FULL_WIDTH_PRIMARY_ZONES: ReadonlySet<RouteZone> = new Set(['wiki', 'inbox', 'review'])

export function routeUsesFullWidthPrimaryWorkspace(route: Pick<Route, 'zone'>): boolean {
  const z = route.zone
  return z != null && FULL_WIDTH_PRIMARY_ZONES.has(z)
}

/**
 * Map a detail overlay to a full-width primary route (`/wiki/…` uses dedicated helpers;
 * this covers host paths that use `?panel=` like `/inbox` or future `/library`).
 *
 * Add `case`s when introducing new doc types (e.g. Drive via `indexed-file` + new zone).
 */
export function primarySurfaceRouteForOverlay(overlay: Overlay): Pick<Route, 'zone' | 'overlay'> | null {
  switch (overlay.type) {
    case 'email':
      return { zone: 'inbox', overlay }
    // Future: Google Drive / indexed docs — add `RouteZone` + `parseRoute`/`routeToUrl` + Assistant branch
    // case 'indexed-file':
    //   return overlay.id ? { zone: 'library', overlay } : null
    default:
      return null
  }
}
