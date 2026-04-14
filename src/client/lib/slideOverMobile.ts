/**
 * Whether to finish dismissing after pointer up.
 * @param dragPx — rightward offset from the open position (px)
 * @param panelWidth — panel width (px)
 * @param velocityRight — horizontal velocity (px/ms), positive = moving right
 */
export function shouldDismissMobileSwipe(
  dragPx: number,
  panelWidth: number,
  velocityRight: number,
): boolean {
  const w = Math.max(panelWidth, 1)
  if (dragPx >= w * 0.22) return true
  if (velocityRight > 0.45 && dragPx > 12) return true
  return false
}

const INTERACTIVE = 'a,button,input,select,textarea,[contenteditable],[role="button"],[role="link"]'

/** Returns true if the pointer-down target is (or is inside) an interactive element. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest(INTERACTIVE)
}

/**
 * Direction-lock decision after a few pixels of movement.
 * Only commits to a rightward swipe when the horizontal component dominates.
 */
export function swipeDirection(dx: number, dy: number): 'swipe' | 'scroll' | 'undecided' {
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx < 5 && ady < 5) return 'undecided'
  if (adx > ady && dx > 0) return 'swipe'
  return 'scroll'
}
