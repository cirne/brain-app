import type { Overlay } from '@client/router.js'

/** Wiki path when overlay is a wiki doc; otherwise undefined. */
export function wikiOverlayPath(o: Overlay | undefined): string | undefined {
  if (o?.type === 'wiki' && o.path?.trim()) return o.path.trim()
  return undefined
}

/**
 * Update stack after `navigateShell` when user navigates between wiki pages on mobile chat overlay.
 * Does not run when {@link suppressNextMutation} was used for programmatic back-pop.
 */
export function nextMobileWikiOverlayStack(params: {
  isMobile: boolean
  wikiPrimaryActive: boolean
  suppressMutation: boolean
  prevOverlay: Overlay | undefined
  nextOverlay: Overlay | undefined
  priorStack: readonly string[]
}): string[] {
  const {
    isMobile,
    wikiPrimaryActive,
    suppressMutation,
    prevOverlay,
    nextOverlay,
    priorStack,
  } = params
  if (!isMobile || wikiPrimaryActive || suppressMutation) return [...priorStack]

  const nextPath = wikiOverlayPath(nextOverlay)
  if (!nextPath) return []

  const prevPath = wikiOverlayPath(prevOverlay)
  const prevWasWiki = prevOverlay?.type === 'wiki'

  if (!prevWasWiki) return [nextPath]
  if (!prevPath || prevPath === nextPath) return [...priorStack]

  const s = [...priorStack]
  if (s.length === 0) return [prevPath, nextPath]
  if (s[s.length - 1] === nextPath) return s
  return [...s, nextPath]
}

/**
 * Pop stack for mobile wiki overlay back; returns previous path to navigate to, or null to close overlay.
 */
export function popMobileWikiOverlayStack(stack: readonly string[]): {
  nextStack: string[]
  navigateToPath: string | null
} {
  if (stack.length <= 1) {
    return { nextStack: [], navigateToPath: null }
  }
  const nextStack = stack.slice(0, -1)
  const navigateToPath = nextStack[nextStack.length - 1] ?? null
  return { nextStack, navigateToPath }
}
