import { overlaySupportsMobileChatBridge } from '@client/lib/mobileDetailChatOverlay.js'
import type { Overlay, Route } from '@client/router.js'

export type CloseOverlayStrategy = 'none' | 'immediate' | 'animated_desktop'

/**
 * Preserve `/c/…` session when opening overlays from the chat column.
 * Pass `effectiveSessionId` when the bar used a short tail (`sessionTail`) resolved client-side.
 */
export function chatSessionPatch(
  route: Route,
  effectiveSessionId?: string | null,
): Pick<Route, 'sessionId'> {
  if (route.hubActive) return {}
  const id = effectiveSessionId ?? route.sessionId
  return id ? { sessionId: id } : {}
}

export function shouldReplaceWikiOverlay(route: Route): boolean {
  const t = route.overlay?.type
  return t === 'wiki' || t === 'wiki-dir'
}

/**
 * Mobile + doc/email thread: use chat shell (not /hub) so AgentChat is mounted
 * with a composer below the slide-over.
 */
export function hubActiveForOpenOverlay(
  route: Route,
  overlay: Overlay,
  isMobile: boolean,
): boolean {
  if (isMobile && overlaySupportsMobileChatBridge(overlay)) return false
  return Boolean(route.hubActive || route.overlay?.type === 'hub')
}

/**
 * How to close the current overlay: full replace navigation vs WorkspaceSplit animation.
 */
export function closeOverlayStrategy(
  route: Route,
  useDesktopSplitDetail: boolean,
): CloseOverlayStrategy {
  if (!route.overlay) return 'none'
  const t = route.overlay.type
  if (t === 'hub' || t === 'chat-history') return 'immediate'
  if (useDesktopSplitDetail) return 'animated_desktop'
  return 'immediate'
}

/** Local calendar day string for “today” navigation. */
export function formatLocalDateYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
