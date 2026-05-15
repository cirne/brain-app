import { isNewChat } from '@client/lib/assistantShellNavigation.js'
import type { Route, SurfaceContext } from '@client/router.js'
import { wikiMarkdownBasenameDisplayTitle } from '@client/lib/wikiDirBreadcrumb.js'

export type MobileCompactNavRoutePick = Pick<
  Route,
  'zone' | 'sessionId' | 'sessionTail' | 'overlay' | 'tunnelHandle'
>

function compactNavFallbackTitle(
  route: MobileCompactNavRoutePick,
  effectiveChatSessionId: string | null | undefined,
  chatTitle: string | undefined,
): string {
  if (route.zone === 'settings') return 'Settings'
  if (route.zone === 'hub') return 'Braintunnel Hub'
  if (route.zone === 'inbox') return 'Inbox'
  if (route.zone === 'library') return 'Library'
  if (route.zone === 'tunnels') {
    const h = route.tunnelHandle?.trim()
    return h ? `@${h}` : 'Tunnels'
  }
  const t = chatTitle?.trim()
  if (t) return t
  if (isNewChat(route, effectiveChatSessionId)) return 'Braintunnel'
  return 'Chat'
}

/**
 * OPP-092 mobile L1 center title on chat-bridge routes: prefer the foreground overlay
 * (wiki doc, folder, mail, …) over `chatTitleForUrl`, which is often empty while a panel is open.
 */
export function mobileCompactNavCenterTitle(
  route: MobileCompactNavRoutePick,
  ctx: SurfaceContext,
  chatTitleForUrl: string | undefined,
  effectiveChatSessionId: string | null | undefined,
): string {
  const overlay = route.overlay

  if (!overlay) return compactNavFallbackTitle(route, effectiveChatSessionId, chatTitleForUrl)

  if (overlay.type === 'wiki' && overlay.path) {
    if (ctx.type === 'wiki' && ctx.path === overlay.path && ctx.title.trim()) return ctx.title.trim()
    return wikiMarkdownBasenameDisplayTitle(overlay.path)
  }
  if (overlay.type === 'wiki-dir') {
    if (ctx.type === 'wiki-dir' && ctx.title.trim()) return ctx.title.trim()
    const parts = (overlay.path ?? '').split('/').filter(Boolean)
    const tail = parts[parts.length - 1]
    return tail ? tail.replace(/-/g, ' ') : 'Wiki'
  }
  if (overlay.type === 'email' && ctx.type === 'email' && ctx.subject.trim()) return ctx.subject.trim()
  if (overlay.type === 'email-draft' && ctx.type === 'email-draft' && ctx.subject.trim())
    return ctx.subject.trim()
  if (overlay.type === 'messages' && ctx.type === 'messages' && ctx.displayLabel.trim())
    return ctx.displayLabel.trim()
  if (overlay.type === 'mail-search' && ctx.type === 'mail-search' && ctx.query.trim())
    return ctx.query.trim()
  if (overlay.type === 'file' && overlay.path && ctx.type === 'file' && ctx.path === overlay.path && ctx.title.trim())
    return ctx.title.trim()
  if (
    overlay.type === 'indexed-file' &&
    overlay.id &&
    ctx.type === 'indexed-file' &&
    ctx.id === overlay.id &&
    ctx.title.trim()
  ) {
    return ctx.title.trim()
  }
  if (overlay.type === 'calendar' && ctx.type === 'calendar') {
    return `Calendar · ${ctx.date}`
  }

  return compactNavFallbackTitle(route, effectiveChatSessionId, chatTitleForUrl)
}
