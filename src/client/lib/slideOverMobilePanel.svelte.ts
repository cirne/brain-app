import { shouldDismissMobileSwipe, isInteractiveTarget, swipeDirection, effectiveSlidePanelWidth } from './slideOverMobile.js'

export type CreateSlideOverMobilePanelOptions = {
  getMobilePanel: () => boolean
  getOnClose: () => () => void
}

export function createSlideOverMobilePanel(options: CreateSlideOverMobilePanelOptions) {
  const { getMobilePanel, getOnClose } = options

  let rootEl = $state<HTMLDivElement | undefined>()
  let slideBodyEl = $state<HTMLDivElement | undefined>()
  let panelW = $state(0)
  let slidePx = $state(0)
  let transitionEnabled = $state(false)
  let closing = $state(false)
  let enterStarted = $state(false)
  let swipeState = $state<'idle' | 'pending' | 'dragging'>('idle')
  let swipeStartX = 0
  let swipeStartY = 0
  let swipeStartSlidePx = 0
  let lastX = 0
  let lastT = 0
  let velocity = 0
  let swipePointerId = -1

  function effectiveW(): number {
    return effectiveSlidePanelWidth(panelW)
  }

  $effect(() => {
    console.log('[effect-debug]', 'src/client/lib/slideOverMobilePanel.svelte.ts', '#1')
    if (!getMobilePanel() || enterStarted) return
    const w = effectiveW()
    if (w <= 0) return
    enterStarted = true
    slidePx = w
    transitionEnabled = false
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        transitionEnabled = true
        slidePx = 0
      })
    })
  })

  function beginCloseAnimation() {
    const w = effectiveW()
    if (slidePx >= w - 0.5) {
      closing = false
      getOnClose()()
      return
    }
    closing = true
    transitionEnabled = true
    slidePx = w
  }

  function closeAnimated() {
    if (!getMobilePanel()) {
      getOnClose()()
      return
    }
    swipeState = 'idle'
    beginCloseAnimation()
  }

  function onPointerDown(e: PointerEvent) {
    if (!getMobilePanel() || closing || swipeState !== 'idle') return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (isInteractiveTarget(e.target)) return
    swipeState = 'pending'
    swipePointerId = e.pointerId
    swipeStartX = e.clientX
    swipeStartY = e.clientY
    swipeStartSlidePx = slidePx
    lastX = e.clientX
    lastT = performance.now()
    velocity = 0
  }

  function onPointerMove(e: PointerEvent) {
    if (!getMobilePanel() || e.pointerId !== swipePointerId) return

    if (swipeState === 'pending') {
      const dx = e.clientX - swipeStartX
      const dy = e.clientY - swipeStartY
      const dir = swipeDirection(dx, dy)
      if (dir === 'undecided') return
      if (dir === 'scroll') {
        swipeState = 'idle'
        return
      }
      slideBodyEl?.setPointerCapture(e.pointerId)
      swipeState = 'dragging'
      transitionEnabled = false
    }

    if (swipeState !== 'dragging') return
    const delta = e.clientX - swipeStartX
    slidePx = Math.min(effectiveW(), swipeStartSlidePx + Math.max(0, delta))
    const t = performance.now()
    const dt = t - lastT
    if (dt > 0) velocity = (e.clientX - lastX) / dt
    lastX = e.clientX
    lastT = t
  }

  function onPointerEnd(e: PointerEvent) {
    if (!getMobilePanel() || e.pointerId !== swipePointerId) return
    if (swipeState === 'dragging') {
      if (slideBodyEl?.hasPointerCapture(e.pointerId)) slideBodyEl.releasePointerCapture(e.pointerId)
      transitionEnabled = true
      if (shouldDismissMobileSwipe(slidePx, effectiveW(), velocity)) {
        beginCloseAnimation()
      } else {
        slidePx = 0
      }
    }
    swipeState = 'idle'
  }

  function onPanelTransitionEnd(e: TransitionEvent) {
    if (!getMobilePanel() || e.propertyName !== 'transform') return
    if (!closing) return
    closing = false
    getOnClose()()
  }

  return {
    get rootEl() {
      return rootEl
    },
    set rootEl(v: HTMLDivElement | undefined) {
      rootEl = v
    },
    get panelW() {
      return panelW
    },
    set panelW(v: number) {
      panelW = v
    },
    get slideBodyEl() {
      return slideBodyEl
    },
    set slideBodyEl(v: HTMLDivElement | undefined) {
      slideBodyEl = v
    },
    get slidePx() {
      return slidePx
    },
    get transitionEnabled() {
      return transitionEnabled
    },
    get closing() {
      return closing
    },
    get swipeState() {
      return swipeState
    },
    onPointerDown,
    onPointerMove,
    onPointerEnd,
    onPanelTransitionEnd,
    closeAnimated,
  }
}
