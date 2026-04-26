import type { Overlay, SurfaceContext } from '../router.js'

/** Static L2 title when thread-specific title is not shown. */
export function titleForOverlay(o: Overlay): string {
  if (o.type === 'wiki' || o.type === 'wiki-dir') return 'Docs'
  if (o.type === 'file') return 'File'
  if (o.type === 'email') return 'Inbox'
  if (o.type === 'messages') return 'Messages'
  if (o.type === 'phone-access') return 'Connect Phone'
  if (o.type === 'your-wiki') return 'Your Wiki'
  if (o.type === 'hub-source') return 'Search index source'
  if (o.type === 'hub-add-folders') return 'Add folders to index'
  if (o.type === 'hub-wiki-about') return 'Your wiki'
  return 'Calendar'
}

/** Email thread subject for SlideOver center title, or null when not ready / mismatched. */
export function emailThreadTitleForSlideOver(
  overlay: Overlay,
  surfaceContext: SurfaceContext,
): string | null {
  if (overlay.type !== 'email' || !overlay.id) return null
  if (surfaceContext.type !== 'email') return null
  if (surfaceContext.threadId !== overlay.id) return null
  const s = surfaceContext.subject?.trim()
  if (!s || s === '(loading)') return null
  return s
}

/** Messages thread label for SlideOver center title, or null when not ready / mismatched. */
export function messagesTitleForSlideOver(
  overlay: Overlay,
  surfaceContext: SurfaceContext,
): string | null {
  if (overlay.type !== 'messages' || !overlay.chat) return null
  if (surfaceContext.type !== 'messages') return null
  if (surfaceContext.chat !== overlay.chat) return null
  const s = surfaceContext.displayLabel?.trim()
  if (!s || s === '(loading)') return null
  return s
}
