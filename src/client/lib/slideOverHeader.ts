import type { Overlay, SurfaceContext } from '../router.js'

/** Static L2 title when thread-specific title is not shown. */
export function titleForOverlay(o: Overlay): string {
  if (o.type === 'wiki' || o.type === 'wiki-dir') return 'Docs'
  if (o.type === 'file') return 'File'
  if (o.type === 'indexed-file') return 'File'
  if (o.type === 'visual-artifact') return 'Image'
  if (o.type === 'email') return 'Inbox'
  if (o.type === 'email-draft') return 'Draft'
  if (o.type === 'mail-search') return 'Mail search'
  if (o.type === 'messages') return 'Messages'
  if (o.type === 'your-wiki') return 'Your Wiki'
  if (o.type === 'hub-source') return 'Search index source'
  if (o.type === 'google-account') return 'Google account'
  if (o.type === 'slack-workspace') return 'Slack workspace'
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

/** Email draft subject for SlideOver center title when context matches overlay draft id. */
/** Indexed Drive/local file title when context matches overlay id. */
export function indexedFileTitleForSlideOver(
  overlay: Overlay,
  surfaceContext: SurfaceContext,
): string | null {
  if (overlay.type !== 'indexed-file' || !overlay.id) return null
  if (surfaceContext.type !== 'indexed-file') return null
  if (surfaceContext.id !== overlay.id) return null
  const s = surfaceContext.title?.trim()
  if (!s || s === '(loading)') return null
  return s
}

export function emailDraftTitleForSlideOver(
  overlay: Overlay,
  surfaceContext: SurfaceContext,
): string | null {
  if (overlay.type !== 'email-draft' || !overlay.id) return null
  if (surfaceContext.type !== 'email-draft') return null
  if (surfaceContext.draftId !== overlay.id) return null
  const s = surfaceContext.subject?.trim()
  if (!s || s === '(loading)') return null
  return s
}
