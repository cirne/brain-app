export const AGENT_PANEL_WIDTH_KEY = 'brain-agent-panel-width'

export const DEFAULT_AGENT_PANEL_WIDTH = 420

export const MIN_AGENT_PANEL_WIDTH = 280

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
