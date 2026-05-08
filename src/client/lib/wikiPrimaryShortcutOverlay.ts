import type { Overlay } from '../router.js'

/**
 * Top-nav Wiki / ⌘⇧H target overlay.
 * Hub navigation (`path` omitted) uses wiki-dir root (`/wiki/`).
 */
export function overlayForWikiPrimaryShortcut(
  path: string | undefined,
): Extract<Overlay, { type: 'wiki' } | { type: 'wiki-dir' }> {
  const p = path?.trim()
  if (p) return { type: 'wiki', path: p }
  return { type: 'wiki-dir' }
}
