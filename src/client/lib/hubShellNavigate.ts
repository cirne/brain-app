import { navigate, type NavigateOptions, type Overlay, type Route } from '../router.js'

/**
 * Brain Hub list → detail: push `/hub/…` with `hubActive`.
 * Wiki uses `replace` when already on a wiki overlay (matches `openWikiDoc` / chat shell).
 * When `hubActive` is false, detail opens on the main chat column (`/wiki/…` etc.), not under `/hub/…`.
 */
export function applyHubDetailNavigation(
  route: Route,
  overlay: Overlay,
  opts?: NavigateOptions,
  hubActive: boolean = true,
): void {
  let effectiveOpts = opts
  const wikiLike =
    overlay.type === 'wiki' || overlay.type === 'wiki-dir'
  const routeWikiLike =
    route.overlay?.type === 'wiki' || route.overlay?.type === 'wiki-dir'
  if (wikiLike && effectiveOpts === undefined && routeWikiLike) {
    effectiveOpts = { replace: true }
  }
  navigate({ overlay, hubActive }, effectiveOpts)
}
