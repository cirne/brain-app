<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import { cn } from '@client/lib/cn.js'
  import {
    detailPanelHalfWidth,
    nextPanelWidthAfterDrag,
    workspaceSplitBasisPx,
  } from '@client/lib/app/agentPanelWidth.js'
  import { easeOutCubic } from '@client/lib/workspaceSplit/easing.js'

  type Props = {
    /** `!!route.overlay` — drives `.split.has-detail` for chat column width rules. */
    hasDetail: boolean
    /**
     * `bind:clientWidth` from the Assistant workspace column (main flex area beside the history
     * rail). Keeps default half-width + drag caps on that region, not a mistaken viewport-wide measure.
     */
    workspaceColumnWidthPx?: number
    /** Desktop side-by-side detail pane (measured workspace width + not mobile viewport). */
    desktopDetailOpen: boolean
    chat: Snippet
    desktopDetail: Snippet
    /** After close animation (or immediate); parent clears route. */
    onNavigateClear: () => void
    /** Desktop: detail pane fills workspace (chat hidden). Toggled from SlideOver header. */
    detailFullscreen?: boolean
  }

  let {
    hasDetail,
    workspaceColumnWidthPx = 0,
    desktopDetailOpen,
    chat,
    desktopDetail,
    onNavigateClear,
    detailFullscreen = $bindable(false),
  }: Props = $props()

  /** Desktop only — no-op on narrow viewports. */
  export function toggleDetailFullscreen() {
    if (typeof window !== 'undefined' && window.innerWidth <= 767) return
    detailFullscreen = !detailFullscreen
  }

  let splitEl = $state<HTMLDivElement | null>(null)
  /** True until the next time the detail pane opens and we apply a fresh 50% width. */
  let pendingHalfWidthOnOpen = $state(true)

  let detailPanelWidth = $state(0)
  /** Current flex width; updated every frame while opening/closing (layout + paint on both panes). */
  let detailVisibleW = $state(0)
  let detailPanelResizing = $state(false)

  let rafId = 0
  let animatingWidth = $state(false)

  function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function cancelWidthAnim() {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    animatingWidth = false
  }

  function runWidthAnim(
    from: number,
    to: number,
    durationMs: number,
    onFrame: (_w: number) => void,
    onDone: () => void,
  ) {
    cancelWidthAnim()
    animatingWidth = true
    const start = performance.now()
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs)
      const w = from + (to - from) * easeOutCubic(t)
      onFrame(w)
      if (t < 1) {
        rafId = requestAnimationFrame(tick)
      } else {
        onFrame(to)
        animatingWidth = false
        rafId = 0
        onDone()
      }
    }
    rafId = requestAnimationFrame(tick)
  }

  const DURATION_MS = 320

  function splitBasisPx(): number {
    const measured = splitEl?.clientWidth ?? 0
    return workspaceSplitBasisPx(workspaceColumnWidthPx ?? 0, measured)
  }

  function syncDetailWidthToSplit() {
    const sw = splitBasisPx()
    if (sw <= 0 || !desktopDetailOpen) return
    if (pendingHalfWidthOnOpen) {
      detailPanelWidth = detailPanelHalfWidth(sw)
      pendingHalfWidthOnOpen = false
    } else {
      detailPanelWidth = Math.min(Math.max(0, detailPanelWidth), sw)
    }
    if (!animatingWidth) {
      detailVisibleW = detailPanelWidth
    }
  }

  $effect(() => {
    if (!desktopDetailOpen) {
      pendingHalfWidthOnOpen = true
    }
  })

  $effect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 767px)')
    const onMq = () => {
      if (mq.matches) detailFullscreen = false
    }
    mq.addEventListener('change', onMq)
    onMq()
    return () => mq.removeEventListener('change', onMq)
  })

  $effect(() => {
    void workspaceColumnWidthPx
    syncDetailWidthToSplit()
  })

  $effect(() => {
    const el = splitEl
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      syncDetailWidthToSplit()
    })
    ro.observe(el)
    syncDetailWidthToSplit()
    return () => {
      ro.disconnect()
    }
  })

  $effect(() => {
    if (!desktopDetailOpen) {
      detailFullscreen = false
      cancelWidthAnim()
      detailVisibleW = 0
      return
    }
    const target = untrack(() => detailPanelWidth)
    if (prefersReducedMotion()) {
      detailVisibleW = target
      return
    }
    detailVisibleW = 0
    runWidthAnim(0, target, DURATION_MS, (w) => {
      detailVisibleW = w
    }, () => {})
    return () => {
      cancelWidthAnim()
    }
  })

  /** Escape / close button: animate width to 0 then clear route. */
  export function closeDesktopAnimated() {
    if (!desktopDetailOpen) return
    if (prefersReducedMotion()) {
      onNavigateClear()
      return
    }
    if (detailVisibleW <= 0.5) {
      onNavigateClear()
      return
    }
    runWidthAnim(
      detailVisibleW,
      0,
      DURATION_MS,
      (w) => {
        detailVisibleW = w
      },
      () => {
        onNavigateClear()
      },
    )
  }

  function onDetailResizePointerDown(e: PointerEvent) {
    if (typeof window !== 'undefined' && window.innerWidth <= 767) return
    e.preventDefault()
    const el = e.currentTarget as HTMLButtonElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = detailPanelWidth
    detailPanelResizing = true
    cancelWidthAnim()
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: PointerEvent) {
      const sw = splitBasisPx()
      if (sw <= 0) return
      detailPanelWidth = nextPanelWidthAfterDrag(startW, startX, ev.clientX, sw)
      detailVisibleW = detailPanelWidth
    }
    function onUp(ev: PointerEvent) {
      detailPanelResizing = false
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
</script>

<div class="workspace relative flex min-h-0 flex-1 flex-col">
  <div
    bind:this={splitEl}
    class={cn(
      'split relative flex min-h-0 flex-1',
      hasDetail && 'has-detail',
      detailFullscreen && desktopDetailOpen && 'detail-fullscreen',
    )}
  >
    <section class={cn(
      'chat-pane z-0 flex min-w-0 min-h-0 flex-1 flex-col',
      detailFullscreen && desktopDetailOpen && 'chat-pane-hidden basis-0 grow-0 w-0 min-w-0 overflow-hidden opacity-0 pointer-events-none',
    )}>
      {@render chat()}
    </section>

    {#if desktopDetailOpen}
      <section
        class={cn(
          'detail-pane relative z-[1] flex shrink-0 min-w-0 flex-col overflow-hidden',
          detailPanelResizing && 'resizing',
          detailFullscreen && 'detail-pane-fullscreen flex-1 min-w-0 max-w-none',
        )}
        style:width={detailFullscreen ? undefined : `${detailVisibleW}px`}
      >
        {#if !detailFullscreen}
          <button
            type="button"
            class="detail-resize-handle absolute left-0 top-0 bottom-0 -ml-2 z-[3] flex w-4 cursor-col-resize items-center justify-center border-none bg-transparent p-0 [touch-action:none]"
            aria-label="Resize detail panel"
            title="Drag to resize"
            onpointerdown={onDetailResizePointerDown}
          >
            <span
              class={cn(
                'detail-resize-grip h-[30px] w-2 transition-opacity',
                detailPanelResizing ? 'opacity-100' : 'opacity-45',
              )}
              aria-hidden="true"
            ></span>
          </button>
        {/if}
        {@render desktopDetail()}
      </section>
    {/if}
  </div>
</div>

<style>
  /* Resize-grip surface uses background-color + a layered repeating gradient + inset shadows that
     don't translate to Tailwind utilities cleanly. */
  .detail-resize-grip {
    background-color: var(--text-2);
    background-image: repeating-linear-gradient(
      180deg,
      transparent 0 4px,
      rgba(0, 0, 0, 0.1) 4px 5px
    );
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.22),
      inset 0 -1px 0 rgba(0, 0, 0, 0.12);
  }
</style>
