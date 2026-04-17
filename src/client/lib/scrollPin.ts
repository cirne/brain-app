/** Pixels from the bottom to still count as “at bottom” (BUG-007). */
export const SCROLL_PIN_THRESHOLD_PX = 48

/**
 * True when the user is at (or near) the bottom of a scroll container — standard chat “stick to latest”.
 */
export function computePinnedToBottom(
  el: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>,
  thresholdPx = SCROLL_PIN_THRESHOLD_PX,
): boolean {
  const slack = el.scrollHeight - el.scrollTop - el.clientHeight
  return slack <= thresholdPx
}
