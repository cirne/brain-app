<script lang="ts">
  import { untrack } from 'svelte'
  import type { Snippet } from 'svelte'
  import {
    FALLBACK_DETAIL_PANEL_WIDTH,
    clampAgentPanelWidth,
    loadStoredDetailPanelWidth,
    nextPanelWidthAfterDrag,
    persistDetailPanelWidth,
    resolveDetailPanelWidth,
  } from '@client/lib/app/agentPanelWidth.js'
  import { easeOutCubic } from '@client/lib/workspaceSplit/easing.js'

  type Props = {
    /** `!!route.overlay` — drives `.split.has-detail` for chat column width rules. */
    hasDetail: boolean
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

  const storedDetailPreference = loadStoredDetailPanelWidth()

  let splitEl = $state<HTMLDivElement | null>(null)
  /** After first successful measure of `.split`, we only clamp; before that we resolve from storage + split. */
  let splitWidthInitialized = $state(false)

  let detailPanelWidth = $state(FALLBACK_DETAIL_PANEL_WIDTH)
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

  function syncDetailWidthToSplit() {
    const sw = splitEl?.clientWidth ?? 0
    if (sw <= 0) return
    if (!splitWidthInitialized) {
      detailPanelWidth = resolveDetailPanelWidth(storedDetailPreference, sw)
      splitWidthInitialized = true
    } else {
      detailPanelWidth = clampAgentPanelWidth(detailPanelWidth, sw)
    }
    if (desktopDetailOpen && !animatingWidth) {
      detailVisibleW = detailPanelWidth
    }
  }

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
      const sw = splitEl?.clientWidth ?? 0
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
      const sw = splitEl?.clientWidth ?? 0
      if (sw > 0) persistDetailPanelWidth(detailPanelWidth, sw)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

</script>

<div class="workspace">
  <div
    bind:this={splitEl}
    class="split"
    class:has-detail={hasDetail}
    class:detail-fullscreen={detailFullscreen && desktopDetailOpen}
  >
    <section class="chat-pane" class:chat-pane-hidden={detailFullscreen && desktopDetailOpen}>
      {@render chat()}
    </section>

    {#if desktopDetailOpen}
      <section
        class="detail-pane"
        class:resizing={detailPanelResizing}
        class:detail-pane-fullscreen={detailFullscreen}
        style:width={detailFullscreen ? undefined : `${detailVisibleW}px`}
      >
        {#if !detailFullscreen}
          <button
            type="button"
            class="detail-resize-handle"
            aria-label="Resize detail panel"
            title="Drag to resize"
            onpointerdown={onDetailResizePointerDown}
          >
            <span class="detail-resize-grip" aria-hidden="true"></span>
          </button>
        {/if}
        {@render desktopDetail()}
      </section>
    {/if}
  </div>
</div>

<style>
  .workspace {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
  }

  .split {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }

  .chat-pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    z-index: 0;
  }

  .detail-pane {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .detail-resize-handle {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 16px;
    margin-left: -8px;
    z-index: 3;
    cursor: col-resize;
    touch-action: none;
    border: none;
    padding: 0;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .detail-resize-grip {
    width: 8px;
    height: 30px;
    border-radius: 4px;
    opacity: 0.45;
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

  .detail-pane.resizing .detail-resize-grip {
    opacity: 1;
  }

  /* Desktop fullscreen: hide chat column; detail fills workspace */
  .split.detail-fullscreen .chat-pane-hidden {
    flex: 0 0 0;
    width: 0;
    min-width: 0;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
  }

  .split.detail-fullscreen .detail-pane-fullscreen {
    flex: 1 1 auto;
    min-width: 0;
    max-width: none;
  }
</style>
