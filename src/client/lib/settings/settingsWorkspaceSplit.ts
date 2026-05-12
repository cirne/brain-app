import type { Overlay } from '@client/router.js'
import type { Route } from '@client/router.js'
import { routeUsesFullWidthPrimaryWorkspace } from '@client/lib/primarySurfaceRoute.js'

const OVERLAY_SUPPRESSES_WORKSPACE_SPLIT_DETAIL = new Set<Overlay['type']>([
  'hub',
  'chat-history',
  'brain-access',
  'brain-access-policy',
  'settings-connections',
  'settings-wiki',
])

export function overlaySuppressesWorkspaceSplitDetail(overlay: Overlay): boolean {
  return OVERLAY_SUPPRESSES_WORKSPACE_SPLIT_DETAIL.has(overlay.type)
}

/** True when the workspace split should allocate the right-hand detail column (non-primary zones). */
export function routeShowsWorkspaceSplitDetail(route: Route): boolean {
  if (routeUsesFullWidthPrimaryWorkspace(route)) return false
  const o = route.overlay
  if (!o) return false
  return !overlaySuppressesWorkspaceSplitDetail(o)
}
