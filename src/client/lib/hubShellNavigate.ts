import { navigate, type NavigateOptions, type Overlay, type Route } from '../router.js'

/**
 * Brain Hub list → detail: push `/hub?panel=…` with `hubActive`.
 * Wiki uses `replace` when already on a wiki overlay (matches `openWikiDoc` / chat shell).
 * When `hubActive` is false, detail opens on the main chat column (`/c?panel=…`), not under `/hub?…`.
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
  navigate(
    hubActive
      ? { hubActive: true, wikiActive: false, settingsActive: false, overlay }
      : { hubActive: false, wikiActive: false, settingsActive: false, sessionId: route.sessionId, overlay },
    effectiveOpts,
  )
}

/**
 * Settings list → detail: push `/settings?panel=…` with `settingsActive`.
 * Mirrors {@link applyHubDetailNavigation} for the `/settings` primary column.
 */
export function applySettingsDetailNavigation(
  route: Route,
  overlay: Overlay,
  opts?: NavigateOptions,
  settingsColumnActive: boolean = true,
): void {
  let effectiveOpts = opts
  const wikiLike = overlay.type === 'wiki' || overlay.type === 'wiki-dir'
  const routeWikiLike = route.overlay?.type === 'wiki' || route.overlay?.type === 'wiki-dir'
  if (wikiLike && effectiveOpts === undefined && routeWikiLike) {
    effectiveOpts = { replace: true }
  }
  navigate(
    settingsColumnActive
      ? { settingsActive: true, hubActive: false, wikiActive: false, overlay }
      : {
          settingsActive: false,
          hubActive: false,
          wikiActive: false,
          sessionId: route.sessionId,
          overlay,
        },
    effectiveOpts,
  )
}
