/**
 * Basis width for the chat↔detail split (counts for default 50% and drag bounds).
 * Prefer `bind:clientWidth` on the main workspace column (area beside the history sidebar);
 * fallback to `.split`’s measured width when that binding has not fired yet (~0).
 */
export function workspaceSplitBasisPx(workspaceColumnPx: number, measuredSplitPx: number): number {
  if (workspaceColumnPx > 0) return workspaceColumnPx
  return measuredSplitPx
}

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
