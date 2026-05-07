import type { Overlay } from '../router.js'

export type WikiShareOptsFromRoute = Pick<
  Extract<Overlay, { type: 'wiki' }>,
  'shareHandle' | 'shareOwner' | 'sharePrefix'
>

/**
 * Top-nav Wiki / ⌘⇧H target overlay.
 * Hub navigation (`path` omitted) clears inherited share context so URL is `/wiki`, not `/wiki/@handle`.
 */
export function overlayForWikiPrimaryShortcut(
  path: string | undefined,
  optsFromRoute: WikiShareOptsFromRoute,
): Extract<Overlay, { type: 'wiki' } | { type: 'wiki-dir' }> {
  const p = path?.trim()
  if (p) return { type: 'wiki', path: p, ...optsFromRoute }
  return { type: 'wiki-dir' }
}
