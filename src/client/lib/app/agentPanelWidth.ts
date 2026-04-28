/** Half of the chat+detail split width (detail pane default when opened). */
export function detailPanelHalfWidth(splitWidth: number): number {
  if (splitWidth <= 0) return 0
  return Math.round(splitWidth / 2)
}

/** Panel width after horizontal drag (left edge moves with pointer), bounded to the split only. */
export function nextPanelWidthAfterDrag(
  startWidth: number,
  startPointerX: number,
  clientX: number,
  splitWidth: number,
): number {
  const w = Math.round(startWidth + (startPointerX - clientX))
  if (splitWidth <= 0) return Math.max(0, w)
  return Math.min(Math.max(0, w), splitWidth)
}
