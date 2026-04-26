import { describe, expect, it, vi } from 'vitest'
import { effectiveSlidePanelWidth, shouldDismissMobileSwipe, swipeDirection } from './slideOverMobile.js'

describe('effectiveSlidePanelWidth', () => {
  it('uses panel width when positive', () => {
    expect(effectiveSlidePanelWidth(320)).toBe(320)
  })

  it('falls back to window.innerWidth when panel is 0', () => {
    vi.stubGlobal('window', { innerWidth: 390 })
    expect(effectiveSlidePanelWidth(0)).toBe(390)
    vi.unstubAllGlobals()
  })

  it('uses 400 when window is undefined', () => {
    vi.stubGlobal('window', undefined)
    expect(effectiveSlidePanelWidth(0)).toBe(400)
    vi.unstubAllGlobals()
  })
})

describe('shouldDismissMobileSwipe', () => {
  it('dismisses when dragged past ~22% of width', () => {
    expect(shouldDismissMobileSwipe(100, 400, 0)).toBe(true)
    expect(shouldDismissMobileSwipe(87, 400, 0)).toBe(false)
  })

  it('dismisses on fast rightward flick with small drag', () => {
    expect(shouldDismissMobileSwipe(20, 400, 0.5)).toBe(true)
    expect(shouldDismissMobileSwipe(8, 400, 0.5)).toBe(false)
  })
})

describe('swipeDirection', () => {
  it('is undecided within deadzone', () => {
    expect(swipeDirection(2, 1)).toBe('undecided')
    expect(swipeDirection(0, 0)).toBe('undecided')
  })

  it('detects rightward swipe when horizontal dominates', () => {
    expect(swipeDirection(20, 5)).toBe('swipe')
  })

  it('detects scroll when vertical dominates', () => {
    expect(swipeDirection(5, 20)).toBe('scroll')
    expect(swipeDirection(-10, 3)).toBe('scroll') // leftward is also scroll
  })

  it('detects scroll when leftward (even if horizontal dominates)', () => {
    expect(swipeDirection(-20, 5)).toBe('scroll')
  })
})
