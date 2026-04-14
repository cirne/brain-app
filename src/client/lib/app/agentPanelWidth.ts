/** Legacy key; may hold a narrow width from older builds — not read anymore. */
export const AGENT_PANEL_WIDTH_KEY = 'brain-agent-panel-width'

/**
 * Only set after the user finishes dragging the detail resize handle.
 * If missing, `loadInitialDetailPanelWidth` uses a 50/50 split (not v1 storage).
 */
export const AGENT_PANEL_WIDTH_KEY_V2 = 'brain-agent-panel-width-v2'

/** Fallback when `window` is unavailable (SSR); real default is half the viewport. */
export const FALLBACK_DETAIL_PANEL_WIDTH = 420

export const MIN_AGENT_PANEL_WIDTH = 290

const MAX_AGENT_PANEL_WIDTH_ABS = 920

const SURFACE_RESERVE_PX = 320

/** Upper bound for panel width at a given viewport (desktop shell). */
export function maxAgentPanelWidth(viewportWidth: number): number {
  return Math.min(
    MAX_AGENT_PANEL_WIDTH_ABS,
    Math.max(MIN_AGENT_PANEL_WIDTH, viewportWidth - SURFACE_RESERVE_PX),
  )
}

export function clampAgentPanelWidth(width: number, viewportWidth: number): number {
  return Math.min(
    maxAgentPanelWidth(viewportWidth),
    Math.max(MIN_AGENT_PANEL_WIDTH, Math.round(width)),
  )
}

/** Panel width after horizontal drag (left edge moves with pointer). */
export function nextPanelWidthAfterDrag(
  startWidth: number,
  startPointerX: number,
  clientX: number,
  viewportWidth: number,
): number {
  return clampAgentPanelWidth(startWidth + (startPointerX - clientX), viewportWidth)
}

/** First open (no saved width): ~50/50 split, clamped to min/max for this viewport. */
export function defaultDetailPanelWidth(viewportWidth: number): number {
  return clampAgentPanelWidth(Math.round(viewportWidth / 2), viewportWidth)
}

export function loadInitialDetailPanelWidth(): number {
  if (typeof window === 'undefined') return FALLBACK_DETAIL_PANEL_WIDTH
  try {
    const raw = localStorage.getItem(AGENT_PANEL_WIDTH_KEY_V2)
    if (raw) {
      const n = parseInt(raw, 10)
      if (!Number.isNaN(n)) return clampAgentPanelWidth(n, window.innerWidth)
    }
  } catch {
    /* ignore */
  }
  return defaultDetailPanelWidth(window.innerWidth)
}

/** Call when the user completes a resize drag; do not call for programmatic/window resize alone. */
export function persistDetailPanelWidth(width: number, viewportWidth: number): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(
      AGENT_PANEL_WIDTH_KEY_V2,
      String(clampAgentPanelWidth(width, viewportWidth)),
    )
  } catch {
    /* ignore */
  }
}
