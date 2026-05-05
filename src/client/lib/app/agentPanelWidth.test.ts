import { describe, it, expect } from 'vitest'
import {
  detailPanelHalfWidth,
  nextPanelWidthAfterDrag,
  workspaceSplitBasisPx,
} from './agentPanelWidth.js'

describe('workspaceSplitBasisPx', () => {
  it('uses the smaller of workspace column and measured split when both are known', () => {
    expect(workspaceSplitBasisPx(920, 2000)).toBe(920)
    expect(workspaceSplitBasisPx(2000, 920)).toBe(920)
  })

  it('falls back to measured split when workspace column binding is unset', () => {
    expect(workspaceSplitBasisPx(0, 1100)).toBe(1100)
  })

  it('falls back to workspace column when measured split is not available yet', () => {
    expect(workspaceSplitBasisPx(840, 0)).toBe(840)
  })

  it('treats non-positive workspace column same as unset', () => {
    expect(workspaceSplitBasisPx(-1, 800)).toBe(800)
  })
})

describe('detailPanelHalfWidth', () => {
  it('returns half of split width, rounded', () => {
    expect(detailPanelHalfWidth(1000)).toBe(500)
    expect(detailPanelHalfWidth(801)).toBe(401)
    expect(detailPanelHalfWidth(3)).toBe(2)
  })

  it('returns 0 for non-positive split', () => {
    expect(detailPanelHalfWidth(0)).toBe(0)
    expect(detailPanelHalfWidth(-100)).toBe(0)
  })
})

describe('nextPanelWidthAfterDrag', () => {
  it('moves width with pointer delta (rounded)', () => {
    expect(nextPanelWidthAfterDrag(400, 100, 80, 1200)).toBe(420)
    expect(nextPanelWidthAfterDrag(400, 100, 120, 1200)).toBe(380)
  })

  it('stays within [0, splitWidth]', () => {
    expect(nextPanelWidthAfterDrag(400, 100, -2000, 1200)).toBe(1200)
    expect(nextPanelWidthAfterDrag(300, 100, 1000, 1200)).toBe(0)
    expect(nextPanelWidthAfterDrag(0, 0, 500, 200)).toBe(0)
  })

  it('with non-positive split only floors at 0', () => {
    expect(nextPanelWidthAfterDrag(100, 0, -50, 0)).toBe(150)
    expect(nextPanelWidthAfterDrag(10, 0, 50, 0)).toBe(0)
  })
})
