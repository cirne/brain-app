import { describe, expect, it } from 'vitest'
import { shouldDismissMobileSwipe, swipeDirection } from './slideOverMobile.js'

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
