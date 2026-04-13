import { describe, it, expect } from 'vitest'
import {
  AGENT_PANEL_WIDTH_KEY,
  DEFAULT_AGENT_PANEL_WIDTH,
  MIN_AGENT_PANEL_WIDTH,
  maxAgentPanelWidth,
  clampAgentPanelWidth,
  nextPanelWidthAfterDrag,
} from './agentPanelWidth.js'

describe('AGENT_PANEL_WIDTH_KEY', () => {
  it('matches persisted storage key', () => {
    expect(AGENT_PANEL_WIDTH_KEY).toBe('brain-agent-panel-width')
  })
})

describe('maxAgentPanelWidth', () => {
  it('caps at 920', () => {
    expect(maxAgentPanelWidth(5000)).toBe(920)
  })

  it('uses viewport minus reserve with a floor at min width', () => {
    expect(maxAgentPanelWidth(800)).toBe(480)
    expect(maxAgentPanelWidth(600)).toBe(280)
  })

  it('never goes below min panel width via viewport formula', () => {
    expect(maxAgentPanelWidth(400)).toBe(280)
  })
})

describe('clampAgentPanelWidth', () => {
  it('clamps to min', () => {
    expect(clampAgentPanelWidth(10, 1200)).toBe(MIN_AGENT_PANEL_WIDTH)
  })

  it('clamps to max for viewport', () => {
    expect(clampAgentPanelWidth(2000, 1200)).toBe(maxAgentPanelWidth(1200))
  })

  it('rounds fractional values', () => {
    expect(clampAgentPanelWidth(333.7, 1200)).toBe(334)
  })

  it('passes through in-range values', () => {
    expect(clampAgentPanelWidth(400, 1200)).toBe(400)
  })
})

describe('nextPanelWidthAfterDrag', () => {
  it('widens panel when dragging left (smaller clientX)', () => {
    expect(nextPanelWidthAfterDrag(400, 100, 80, 1200)).toBe(420)
  })

  it('narrows panel when dragging right', () => {
    expect(nextPanelWidthAfterDrag(400, 100, 120, 1200)).toBe(380)
  })

  it('respects clamp at boundaries', () => {
    expect(nextPanelWidthAfterDrag(900, 0, -2000, 1200)).toBe(maxAgentPanelWidth(1200))
    expect(nextPanelWidthAfterDrag(300, 100, 1000, 1200)).toBe(MIN_AGENT_PANEL_WIDTH)
  })
})

describe('DEFAULT_AGENT_PANEL_WIDTH', () => {
  it('is within clamp for a typical desktop viewport', () => {
    const vw = 1280
    expect(DEFAULT_AGENT_PANEL_WIDTH).toBeGreaterThanOrEqual(MIN_AGENT_PANEL_WIDTH)
    expect(DEFAULT_AGENT_PANEL_WIDTH).toBeLessThanOrEqual(maxAgentPanelWidth(vw))
  })
})
