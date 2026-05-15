import type { Overlay, Route, SurfaceContext } from '@client/router.js'

/**
 * Desktop split workspace: preserve wiki, email, or indexed-file overlay on `/c?panel=…` when starting a chat
 * from a full-width wiki/inbox/library composer dock ({@link primarySurfaceDockNavigation} consumers).
 */
export function primaryDockOverlayToKeepForChatSplit(
  route: Pick<Route, 'zone' | 'overlay'>,
  opts: { isMobile: boolean; workspaceColumnWidth: number },
  minSplitPx: number,
): Overlay | undefined {
  if (opts.isMobile || opts.workspaceColumnWidth < minSplitPx) return undefined
  const z = route.zone
  const o = route.overlay
  if (!o) return undefined
  if (z === 'wiki' && (o.type === 'wiki' || o.type === 'wiki-dir')) return o
  if (z === 'inbox' && o.type === 'email' && o.id) return { type: 'email', id: o.id }
  if (z === 'library' && o.type === 'indexed-file' && o.id) {
    return o.source?.trim()
      ? { type: 'indexed-file', id: o.id, source: o.source.trim() }
      : { type: 'indexed-file', id: o.id }
  }
  return undefined
}

/** Surface for first chat turn after leaving inbox-primary without keeping the overlay (narrow / mobile). */
export function inboxThreadSurfaceForCompose(
  overlay: Overlay,
  agentContext: SurfaceContext,
): SurfaceContext | null {
  if (overlay.type !== 'email' || !overlay.id) return null
  if (agentContext.type === 'email' && agentContext.threadId === overlay.id) return agentContext
  return {
    type: 'email',
    threadId: overlay.id,
    subject: '(loading)',
    from: '',
  }
}

/** Surface for first chat turn after leaving library-primary without keeping the overlay (narrow / mobile). */
export function indexedFileSurfaceForCompose(
  overlay: Overlay,
  agentContext: SurfaceContext,
): SurfaceContext | null {
  if (overlay.type !== 'indexed-file' || !overlay.id) return null
  if (agentContext.type === 'indexed-file' && agentContext.id === overlay.id) return agentContext
  return {
    type: 'indexed-file',
    id: overlay.id,
    title: '(loading)',
    sourceKind: '',
    ...(overlay.source?.trim() ? { source: overlay.source.trim() } : {}),
  }
}
