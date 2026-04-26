import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createSlideOverMobilePanel } from './slideOverMobilePanel.svelte.js'

vi.mock('./slideOverMobile.js', () => ({
  shouldDismissMobileSwipe: vi.fn(() => false),
  isInteractiveTarget: vi.fn(() => false),
  swipeDirection: vi.fn(() => 'swipe'),
  effectiveSlidePanelWidth: vi.fn((w: number) => (w > 0 ? w : 400)),
}))

import {
  shouldDismissMobileSwipe,
  isInteractiveTarget,
  swipeDirection,
} from './slideOverMobile.js'

function createMockDiv(): HTMLDivElement {
  return {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  } as unknown as HTMLDivElement
}

function createPointerEvent(
  type: string,
  overrides: Partial<PointerEvent> = {},
): PointerEvent {
  return {
    type,
    pointerId: 1,
    pointerType: 'touch',
    button: 0,
    clientX: 0,
    clientY: 0,
    target: {},
    ...overrides,
  } as unknown as PointerEvent
}

function createTransitionEvent(propertyName: string): TransitionEvent {
  return { propertyName } as TransitionEvent
}

describe('createSlideOverMobilePanel', () => {
  let onClose: Mock<() => void>

  beforeEach(() => {
    vi.clearAllMocks()
    onClose = vi.fn<() => void>()
    vi.mocked(shouldDismissMobileSwipe).mockReturnValue(false)
    vi.mocked(isInteractiveTarget).mockReturnValue(false)
    vi.mocked(swipeDirection).mockReturnValue('swipe')
  })

  function createPanel(mobilePanel = true) {
    return createSlideOverMobilePanel({
      getMobilePanel: () => mobilePanel,
      getOnClose: () => onClose,
    })
  }

  describe('initial state', () => {
    it('starts with idle swipe state', () => {
      const panel = createPanel()
      expect(panel.swipeState).toBe('idle')
    })

    it('starts with slidePx at 0', () => {
      const panel = createPanel()
      expect(panel.slidePx).toBe(0)
    })

    it('starts with transitionEnabled false', () => {
      const panel = createPanel()
      expect(panel.transitionEnabled).toBe(false)
    })

    it('starts with closing false', () => {
      const panel = createPanel()
      expect(panel.closing).toBe(false)
    })
  })

  describe('element bindings', () => {
    it('allows setting and getting rootEl', () => {
      const panel = createPanel()
      const div = createMockDiv()
      panel.rootEl = div
      expect(panel.rootEl).toBe(div)
    })

    it('allows setting and getting slideBodyEl', () => {
      const panel = createPanel()
      const div = createMockDiv()
      panel.slideBodyEl = div
      expect(panel.slideBodyEl).toBe(div)
    })

    it('allows setting and getting panelW', () => {
      const panel = createPanel()
      panel.panelW = 320
      expect(panel.panelW).toBe(320)
    })
  })

  describe('onPointerDown', () => {
    it('ignores when not mobile panel', () => {
      const panel = createPanel(false)
      panel.onPointerDown(createPointerEvent('pointerdown'))
      expect(panel.swipeState).toBe('idle')
    })

    it('ignores right-click on mouse', () => {
      const panel = createPanel()
      panel.onPointerDown(
        createPointerEvent('pointerdown', { pointerType: 'mouse', button: 2 }),
      )
      expect(panel.swipeState).toBe('idle')
    })

    it('ignores interactive targets', () => {
      vi.mocked(isInteractiveTarget).mockReturnValue(true)
      const panel = createPanel()
      panel.onPointerDown(createPointerEvent('pointerdown'))
      expect(panel.swipeState).toBe('idle')
    })

    it('transitions to pending on valid pointer down', () => {
      const panel = createPanel()
      panel.onPointerDown(createPointerEvent('pointerdown', { clientX: 100, clientY: 50 }))
      expect(panel.swipeState).toBe('pending')
    })

    it('allows left-click on mouse', () => {
      const panel = createPanel()
      panel.onPointerDown(
        createPointerEvent('pointerdown', { pointerType: 'mouse', button: 0 }),
      )
      expect(panel.swipeState).toBe('pending')
    })
  })

  describe('onPointerMove', () => {
    it('ignores when not mobile panel', () => {
      const panel = createPanel(false)
      panel.onPointerDown(createPointerEvent('pointerdown'))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 50 }))
      expect(panel.swipeState).toBe('idle')
    })

    it('ignores mismatched pointer id', () => {
      const panel = createPanel()
      panel.onPointerDown(createPointerEvent('pointerdown', { pointerId: 1 }))
      panel.onPointerMove(createPointerEvent('pointermove', { pointerId: 2 }))
      expect(panel.swipeState).toBe('pending')
    })

    it('stays pending when direction undecided', () => {
      vi.mocked(swipeDirection).mockReturnValue('undecided')
      const panel = createPanel()
      panel.onPointerDown(createPointerEvent('pointerdown'))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 2 }))
      expect(panel.swipeState).toBe('pending')
    })

    it('returns to idle when direction is scroll', () => {
      vi.mocked(swipeDirection).mockReturnValue('scroll')
      const panel = createPanel()
      panel.onPointerDown(createPointerEvent('pointerdown'))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 5, clientY: 20 }))
      expect(panel.swipeState).toBe('idle')
    })

    it('transitions to dragging when direction is swipe', () => {
      vi.mocked(swipeDirection).mockReturnValue('swipe')
      const panel = createPanel()
      const slideBodyEl = createMockDiv()
      panel.slideBodyEl = slideBodyEl

      panel.onPointerDown(createPointerEvent('pointerdown'))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 20 }))
      expect(panel.swipeState).toBe('dragging')
      expect(panel.transitionEnabled).toBe(false)
    })

    it('updates slidePx while dragging', () => {
      vi.mocked(swipeDirection).mockReturnValue('swipe')
      const panel = createPanel()
      panel.panelW = 400
      const slideBodyEl = createMockDiv()
      panel.slideBodyEl = slideBodyEl

      panel.onPointerDown(createPointerEvent('pointerdown', { clientX: 0 }))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 20 }))
      expect(panel.swipeState).toBe('dragging')

      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 50 }))
      expect(panel.slidePx).toBe(50)
    })

    it('clamps slidePx to panel width', () => {
      vi.mocked(swipeDirection).mockReturnValue('swipe')
      const panel = createPanel()
      panel.panelW = 400
      const slideBodyEl = createMockDiv()
      panel.slideBodyEl = slideBodyEl

      panel.onPointerDown(createPointerEvent('pointerdown', { clientX: 0 }))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 20 }))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 500 }))
      expect(panel.slidePx).toBe(400)
    })

    it('ignores leftward drag (negative delta)', () => {
      vi.mocked(swipeDirection).mockReturnValue('swipe')
      const panel = createPanel()
      panel.panelW = 400
      const slideBodyEl = createMockDiv()
      panel.slideBodyEl = slideBodyEl

      panel.onPointerDown(createPointerEvent('pointerdown', { clientX: 100 }))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 120 }))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 50 }))
      expect(panel.slidePx).toBe(0)
    })
  })

  describe('onPointerEnd', () => {
    it('ignores when not mobile panel', () => {
      const panel = createPanel(false)
      panel.onPointerEnd(createPointerEvent('pointerup'))
      expect(panel.swipeState).toBe('idle')
    })

    it('ignores mismatched pointer id', () => {
      const panel = createPanel()
      panel.onPointerDown(createPointerEvent('pointerdown', { pointerId: 1 }))
      panel.onPointerEnd(createPointerEvent('pointerup', { pointerId: 2 }))
      expect(panel.swipeState).toBe('pending')
    })

    it('returns to idle from pending', () => {
      const panel = createPanel()
      panel.onPointerDown(createPointerEvent('pointerdown'))
      expect(panel.swipeState).toBe('pending')
      panel.onPointerEnd(createPointerEvent('pointerup'))
      expect(panel.swipeState).toBe('idle')
    })

    it('snaps back when swipe should not dismiss', () => {
      vi.mocked(shouldDismissMobileSwipe).mockReturnValue(false)
      vi.mocked(swipeDirection).mockReturnValue('swipe')
      const panel = createPanel()
      panel.panelW = 400
      const slideBodyEl = createMockDiv()
      panel.slideBodyEl = slideBodyEl

      panel.onPointerDown(createPointerEvent('pointerdown', { clientX: 0 }))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 20 }))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 50 }))
      panel.onPointerEnd(createPointerEvent('pointerup', { clientX: 50 }))

      expect(panel.slidePx).toBe(0)
      expect(panel.transitionEnabled).toBe(true)
      expect(panel.swipeState).toBe('idle')
    })

    it('begins close animation when swipe should dismiss', () => {
      vi.mocked(shouldDismissMobileSwipe).mockReturnValue(true)
      vi.mocked(swipeDirection).mockReturnValue('swipe')
      const panel = createPanel()
      panel.panelW = 400
      const slideBodyEl = createMockDiv()
      panel.slideBodyEl = slideBodyEl

      panel.onPointerDown(createPointerEvent('pointerdown', { clientX: 0 }))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 20 }))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 100 }))
      panel.onPointerEnd(createPointerEvent('pointerup', { clientX: 100 }))

      expect(panel.closing).toBe(true)
      expect(panel.slidePx).toBe(400)
      expect(panel.transitionEnabled).toBe(true)
    })

    it('releases pointer capture on end', () => {
      vi.mocked(swipeDirection).mockReturnValue('swipe')
      const panel = createPanel()
      const slideBodyEl = createMockDiv()
      panel.slideBodyEl = slideBodyEl

      panel.onPointerDown(createPointerEvent('pointerdown'))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 20 }))
      panel.onPointerEnd(createPointerEvent('pointerup'))

      expect(slideBodyEl.releasePointerCapture).toHaveBeenCalledWith(1)
    })
  })

  describe('onPanelTransitionEnd', () => {
    it('ignores when not mobile panel', () => {
      const panel = createPanel(false)
      panel.onPanelTransitionEnd(createTransitionEvent('transform'))
      expect(onClose).not.toHaveBeenCalled()
    })

    it('ignores non-transform transitions', () => {
      vi.mocked(shouldDismissMobileSwipe).mockReturnValue(true)
      vi.mocked(swipeDirection).mockReturnValue('swipe')
      const panel = createPanel()
      panel.panelW = 400
      const slideBodyEl = createMockDiv()
      panel.slideBodyEl = slideBodyEl

      panel.onPointerDown(createPointerEvent('pointerdown'))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 20 }))
      panel.onPointerEnd(createPointerEvent('pointerup'))
      expect(panel.closing).toBe(true)

      panel.onPanelTransitionEnd(createTransitionEvent('opacity'))
      expect(onClose).not.toHaveBeenCalled()
      expect(panel.closing).toBe(true)
    })

    it('calls onClose after transform transition when closing', () => {
      vi.mocked(shouldDismissMobileSwipe).mockReturnValue(true)
      vi.mocked(swipeDirection).mockReturnValue('swipe')
      const panel = createPanel()
      panel.panelW = 400
      const slideBodyEl = createMockDiv()
      panel.slideBodyEl = slideBodyEl

      panel.onPointerDown(createPointerEvent('pointerdown'))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 20 }))
      panel.onPointerEnd(createPointerEvent('pointerup'))
      expect(panel.closing).toBe(true)

      panel.onPanelTransitionEnd(createTransitionEvent('transform'))
      expect(onClose).toHaveBeenCalled()
      expect(panel.closing).toBe(false)
    })

    it('ignores transform transition when not closing', () => {
      const panel = createPanel()
      panel.onPanelTransitionEnd(createTransitionEvent('transform'))
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('closeAnimated', () => {
    it('calls onClose immediately when not mobile panel', () => {
      const panel = createPanel(false)
      panel.closeAnimated()
      expect(onClose).toHaveBeenCalled()
      expect(panel.closing).toBe(false)
    })

    it('begins close animation on mobile panel', () => {
      const panel = createPanel()
      panel.panelW = 400
      panel.closeAnimated()
      expect(panel.closing).toBe(true)
      expect(panel.slidePx).toBe(400)
      expect(panel.transitionEnabled).toBe(true)
    })

    it('resets swipe state to idle', () => {
      vi.mocked(swipeDirection).mockReturnValue('swipe')
      const panel = createPanel()
      panel.panelW = 400
      const slideBodyEl = createMockDiv()
      panel.slideBodyEl = slideBodyEl

      panel.onPointerDown(createPointerEvent('pointerdown'))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 20 }))
      expect(panel.swipeState).toBe('dragging')

      panel.closeAnimated()
      expect(panel.swipeState).toBe('idle')
    })

    it('calls onClose immediately when already at panel width', () => {
      const panel = createPanel()
      panel.panelW = 400

      vi.mocked(shouldDismissMobileSwipe).mockReturnValue(true)
      vi.mocked(swipeDirection).mockReturnValue('swipe')
      const slideBodyEl = createMockDiv()
      panel.slideBodyEl = slideBodyEl

      panel.onPointerDown(createPointerEvent('pointerdown', { clientX: 0 }))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 20 }))
      panel.onPointerMove(createPointerEvent('pointermove', { clientX: 500 }))
      expect(panel.slidePx).toBe(400)
      panel.onPointerEnd(createPointerEvent('pointerup'))

      expect(panel.closing).toBe(false)
      expect(onClose).toHaveBeenCalled()
    })
  })
})
