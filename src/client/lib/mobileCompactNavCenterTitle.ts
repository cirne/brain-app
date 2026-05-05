import type { Overlay, SurfaceContext } from '@client/router.js'

/**
 * OPP-092 mobile L1 center title on chat-bridge routes: prefer the foreground overlay
 * (wiki doc, folder, mail, …) over `chatTitleForUrl`, which is often empty while a panel is open.
 */
export function mobileCompactNavCenterTitle(
  overlay: Overlay | undefined,
  ctx: SurfaceContext,
  chatTitleForUrl: string | undefined,
): string {
  if (!overlay) return chatTitleForUrl?.trim() || 'Chat'

  if (overlay.type === 'wiki' && overlay.path) {
    if (ctx.type === 'wiki' && ctx.path === overlay.path && ctx.title.trim()) return ctx.title.trim()
    const base = overlay.path.replace(/^.*\//, '').replace(/\.md$/i, '') || overlay.path
    return base.replace(/-/g, ' ')
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

  return chatTitleForUrl?.trim() || 'Chat'
}
