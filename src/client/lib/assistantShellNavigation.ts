import { overlaySupportsMobileChatBridge } from '@client/lib/mobileDetailChatOverlay.js'
import { isUuidSessionId } from '@client/router.js'
import type { Overlay, Route } from '@client/router.js'

/**
 * Grey out nav “New chat” only on the idle `/c` slate: no slug in the path, no detail `?panel=…`,
 * and no session id in the bar (empty transcript alone must not disable it).
 */
export function shouldDisableTopNavNewChat(
  route: Route,
  effectiveChatSessionId: string | null | undefined,
): boolean {
  if (route.wikiActive === true || route.hubActive === true || route.settingsActive === true) return false
  if (effectiveChatSessionId) return false
  if (route.sessionId ?? route.sessionTail) return false
  if (route.overlay) return false
  return true
}

/**
 * AgentChat's `onSessionChange` can fire with a **stale** backend session id right after the user
 * picks another chat in the sidebar: the bar URL updates immediately but the transcript map still
 * reflects the previous session briefly. Navigating from that stale id would overwrite the bar.
 */
export function isStaleAgentSessionVersusChatBar(
  agentReportedSessionId: string | null | undefined,
  urlEffectiveSessionId: string | null | undefined,
): boolean {
  if (!agentReportedSessionId || !urlEffectiveSessionId) return false
  if (agentReportedSessionId === urlEffectiveSessionId) return false
  return isUuidSessionId(agentReportedSessionId) && isUuidSessionId(urlEffectiveSessionId)
}

export type CloseOverlayStrategy = 'none' | 'immediate' | 'animated_desktop'

/**
 * Preserve `/c/…` session when opening overlays from the chat column.
 * Pass `effectiveSessionId` when the bar used a short tail (`sessionTail`) resolved client-side.
 */
export function chatSessionPatch(
  route: Route,
  effectiveSessionId?: string | null,
): Pick<Route, 'sessionId' | 'sessionTail'> {
  if (route.hubActive) return {}
  if (route.settingsActive) return {}
  if (route.wikiActive) return {}
  const id = effectiveSessionId ?? route.sessionId
  if (id) return { sessionId: id }
  if (route.sessionTail) return { sessionTail: route.sessionTail }
  return {}
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
  return Boolean(route.hubActive || route.settingsActive || route.overlay?.type === 'hub')
}

/**
 * How to close the current overlay: full replace navigation vs WorkspaceSplit animation.
 */
export function closeOverlayStrategy(
  route: Route,
  useDesktopSplitDetail: boolean,
): CloseOverlayStrategy {
  if (!route.overlay) return 'none'
  if (route.wikiActive) return 'immediate'
  const t = route.overlay.type
  if (t === 'hub' || t === 'chat-history') return 'immediate'
  if (useDesktopSplitDetail) return 'animated_desktop'
  return 'immediate'
}

/** Local calendar day string for “today” navigation. */
export function formatLocalDateYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
