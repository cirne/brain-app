/**
 * Basis width for the chat↔detail split (default 50/50 and drag bounds).
 * Combines `bind:clientWidth` on the workspace column with `.split`’s measured width:
 * use the **smaller positive** value so a stale or mistaken column width (e.g. viewport-wide)
 * cannot reserve half the screen for the detail pane while the rail still consumes space.
 * If only one side is known, use that; if neither, 0.
 */
export function workspaceSplitBasisPx(workspaceColumnPx: number, measuredSplitPx: number): number {
  const col = workspaceColumnPx > 0 ? workspaceColumnPx : null
  const meas = measuredSplitPx > 0 ? measuredSplitPx : null
  if (col != null && meas != null) return Math.min(col, meas)
  if (meas != null) return meas
  if (col != null) return col
  return 0
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
