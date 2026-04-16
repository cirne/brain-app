/** Legacy key; may hold a narrow width from older builds — not read anymore. */
export const AGENT_PANEL_WIDTH_KEY = 'brain-agent-panel-width'

/**
 * Only set after the user finishes dragging the detail resize handle.
 * If missing, `resolveDetailPanelWidth` uses half the measured chat+detail split (not v1 storage).
 */
export const AGENT_PANEL_WIDTH_KEY_V2 = 'brain-agent-panel-width-v2'

/** Fallback when `window` is unavailable (SSR); real default is half the chat+detail split. */
export const FALLBACK_DETAIL_PANEL_WIDTH = 420

export const MIN_AGENT_PANEL_WIDTH = 290

const MAX_AGENT_PANEL_WIDTH_ABS = 920

const SURFACE_RESERVE_PX = 320

/**
 * Upper bound for the detail panel when the horizontal container (viewport or the chat+detail
 * split) is `containerWidth` px wide. Same formula for both: reserve `SURFACE_RESERVE_PX` for
 * the chat pane minimum.
 */
export function maxAgentPanelWidth(containerWidth: number): number {
  return Math.min(
    MAX_AGENT_PANEL_WIDTH_ABS,
    Math.max(MIN_AGENT_PANEL_WIDTH, containerWidth - SURFACE_RESERVE_PX),
  )
}

export function clampAgentPanelWidth(width: number, containerWidth: number): number {
  return Math.min(
    maxAgentPanelWidth(containerWidth),
    Math.max(MIN_AGENT_PANEL_WIDTH, Math.round(width)),
  )
}

/** Panel width after horizontal drag (left edge moves with pointer). */
export function nextPanelWidthAfterDrag(
  startWidth: number,
  startPointerX: number,
  clientX: number,
  splitWidth: number,
): number {
  return clampAgentPanelWidth(startWidth + (startPointerX - clientX), splitWidth)
}

/** No saved preference: half of the chat+detail split, clamped to min/max. */
export function defaultDetailPanelWidth(splitWidth: number): number {
  return clampAgentPanelWidth(Math.round(splitWidth / 2), splitWidth)
}

/** Raw v2 width from storage, or `null` if missing (caller resolves with measured split width). */
export function loadStoredDetailPanelWidth(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(AGENT_PANEL_WIDTH_KEY_V2)
    if (raw) {
      const n = parseInt(raw, 10)
      if (!Number.isNaN(n)) return n
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Resolved detail width for the current split (50/50 when nothing stored). */
export function resolveDetailPanelWidth(storedWidth: number | null, splitWidth: number): number {
  if (splitWidth <= 0) return FALLBACK_DETAIL_PANEL_WIDTH
  if (storedWidth == null) return defaultDetailPanelWidth(splitWidth)
  return clampAgentPanelWidth(storedWidth, splitWidth)
}

/** @deprecated Use `loadStoredDetailPanelWidth` + `resolveDetailPanelWidth` with measured split width. */
export function loadInitialDetailPanelWidth(): number {
  if (typeof window === 'undefined') return FALLBACK_DETAIL_PANEL_WIDTH
  const stored = loadStoredDetailPanelWidth()
  if (stored != null) return clampAgentPanelWidth(stored, window.innerWidth)
  return defaultDetailPanelWidth(window.innerWidth)
}

/** Call when the user completes a resize drag; do not call for programmatic/window resize alone. */
export function persistDetailPanelWidth(width: number, splitWidth: number): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(
      AGENT_PANEL_WIDTH_KEY_V2,
      String(clampAgentPanelWidth(width, splitWidth)),
    )
  } catch {
    /* ignore */
  }
}
