/**
 * Detect whether a header value needs a line clamp / "Show more" control.
 * `scrollHeight > clientHeight` on `-webkit-line-clamp` boxes is unreliable (false positives).
 */
export function elementTextExceedsLineClamp(el: HTMLElement, maxLines: number): boolean {
  if (maxLines <= 0) return false

  const cs = getComputedStyle(el)
  let lineHeight = parseFloat(cs.lineHeight)
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    const fs = parseFloat(cs.fontSize)
    lineHeight = Number.isFinite(fs) && fs > 0 ? fs * 1.25 : 16
  }

  const maxAllowed = lineHeight * maxLines + 1

  const saved = el.style.cssText
  el.style.display = 'block'
  el.style.webkitLineClamp = 'unset'
  el.style.setProperty('-webkit-line-clamp', 'unset')
  el.style.overflow = 'visible'
  el.style.webkitBoxOrient = 'horizontal'
  el.style.setProperty('-webkit-box-orient', 'horizontal')

  const naturalHeight = el.scrollHeight
  el.style.cssText = saved

  return naturalHeight > maxAllowed
}
