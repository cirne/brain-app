<script lang="ts">
  import { Mail } from 'lucide-svelte'
  import Wiki from './Wiki.svelte'
  import Inbox from './Inbox.svelte'
  import Calendar from './Calendar.svelte'
  import WikiFileName from './WikiFileName.svelte'
  import PaneL2Header from './PaneL2Header.svelte'
  import type { Overlay } from '../router.js'
  import type { SurfaceContext } from '../router.js'
  import { shouldDismissMobileSwipe, isInteractiveTarget, swipeDirection } from './slideOverMobile.js'

  type Props = {
    overlay: Overlay
    /** From App — used for email subject in header when a thread is open. */
    surfaceContext?: SurfaceContext
    wikiRefreshKey: number
    calendarRefreshKey: number
    inboxTargetId: string | undefined
    onWikiNavigate: (_path: string | undefined) => void
    onInboxNavigate: (_id: string | undefined) => void
    onContextChange: (_ctx: SurfaceContext) => void
    onOpenSearch?: () => void
    onSummarizeInbox?: (_message: string) => void
    onClose: () => void
    onSync?: () => void
    syncing?: boolean
    /** Full-screen mobile stack: slide in from right, swipe from left edge / animated close. */
    mobilePanel?: boolean
  }

  let {
    overlay,
    surfaceContext = { type: 'chat' } as SurfaceContext,
    wikiRefreshKey,
    calendarRefreshKey,
    inboxTargetId,
    onWikiNavigate,
    onInboxNavigate,
    onContextChange,
    onOpenSearch,
    onSummarizeInbox,
    onClose,
    onSync,
    syncing = false,
    mobilePanel = false,
  }: Props = $props()

  let rootEl = $state<HTMLDivElement | undefined>()
  let slideBodyEl = $state<HTMLDivElement | undefined>()
  let panelW = $state(0)
  /** Rightward offset (px); 0 = fully visible, full width = off-screen right. */
  let slidePx = $state(0)
  let transitionEnabled = $state(false)
  let closing = $state(false)
  let enterStarted = $state(false)
  /** 'idle' | 'pending' (waiting for direction lock) | 'dragging' (captured) */
  let swipeState = $state<'idle' | 'pending' | 'dragging'>('idle')
  let swipeStartX = 0
  let swipeStartY = 0
  let swipeStartSlidePx = 0
  let lastX = 0
  let lastT = 0
  let velocity = 0
  let swipePointerId = -1

  function effectiveW(): number {
    if (panelW > 0) return panelW
    if (typeof window !== 'undefined') return window.innerWidth
    return 400
  }

  $effect(() => {
    if (!mobilePanel || enterStarted) return
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
      onClose()
      return
    }
    closing = true
    transitionEnabled = true
    slidePx = w
  }

  /** Animated slide off to the right, then `onClose` (for mobile + Escape). */
  export function closeAnimated() {
    if (!mobilePanel) {
      onClose()
      return
    }
    swipeState = 'idle'
    beginCloseAnimation()
  }

  function onBackOrHeaderClose() {
    if (mobilePanel) closeAnimated()
    else onClose()
  }

  function onPointerDown(e: PointerEvent) {
    if (!mobilePanel || closing || swipeState !== 'idle') return
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
    if (!mobilePanel || e.pointerId !== swipePointerId) return

    if (swipeState === 'pending') {
      const dx = e.clientX - swipeStartX
      const dy = e.clientY - swipeStartY
      const dir = swipeDirection(dx, dy)
      if (dir === 'undecided') return
      if (dir === 'scroll') { swipeState = 'idle'; return }
      // Confirmed rightward swipe — capture pointer and start dragging
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
    if (!mobilePanel || e.pointerId !== swipePointerId) return
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
    if (!mobilePanel || e.propertyName !== 'transform') return
    if (!closing) return
    closing = false
    onClose()
  }

  const emailHeaderTitle = $derived.by((): string | null => {
    if (overlay.type !== 'email' || !overlay.id) return null
    if (surfaceContext.type !== 'email') return null
    if (surfaceContext.threadId !== overlay.id) return null
    const s = surfaceContext.subject?.trim()
    if (!s || s === '(loading)') return null
    return s
  })

  function titleForOverlay(o: Overlay): string {
    if (o.type === 'wiki') return 'Docs'
    if (o.type === 'email') return 'Inbox'
    return 'Calendar'
  }
</script>

<div
  bind:this={rootEl}
  bind:clientWidth={panelW}
  class="slide-over"
  class:mobile-slide={mobilePanel}
  class:slide-anim={mobilePanel && transitionEnabled}
  class:dragging={mobilePanel && swipeState === 'dragging'}
  data-overlay={overlay.type}
  style:transform={mobilePanel ? `translateX(${slidePx}px)` : undefined}
  ontransitionend={onPanelTransitionEnd}
>
  <PaneL2Header>
    {#snippet left()}
      <button type="button" class="back-btn" onclick={onBackOrHeaderClose} aria-label="Back to chat">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m15 18-6-6 6-6"/>
        </svg>
        <span>Chat</span>
      </button>
    {/snippet}
    {#snippet center()}
      <span
        class="slide-title"
        class:slide-title-wiki={Boolean(
          (overlay.type === 'wiki' && overlay.path) || (overlay.type === 'email' && emailHeaderTitle),
        )}
      >
        {#if overlay.type === 'wiki' && overlay.path}
          <WikiFileName path={overlay.path} />
        {:else if overlay.type === 'email' && emailHeaderTitle}
          <span class="slide-title-email">
            <Mail size={14} strokeWidth={2} aria-hidden="true" />
            <span class="slide-title-email-text">{emailHeaderTitle}</span>
          </span>
        {:else}
          {titleForOverlay(overlay)}
        {/if}
      </span>
    {/snippet}
    {#snippet right()}
      {#if onSync}
        <div class="slide-actions">
          {#if onOpenSearch}
            <button class="slide-action-btn" onclick={onOpenSearch} title="Search (⌘K)" aria-label="Search">
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </button>
          {/if}
          <button
            class="slide-action-btn sync-press-when-syncing"
            class:syncing={syncing}
            onclick={onSync}
            disabled={syncing}
            title="Sync (⌘R)"
            aria-label="Sync"
          >
            <svg class:sync-spinning={syncing} xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
              <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
            </svg>
          </button>
        </div>
      {/if}
      <button type="button" class="close-btn-desktop" onclick={onBackOrHeaderClose} aria-label="Close panel" title="Close">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
        </svg>
      </button>
    {/snippet}
  </PaneL2Header>
  <div
    class="slide-body"
    bind:this={slideBodyEl}
    role={mobilePanel ? 'region' : undefined}
    aria-label={mobilePanel ? 'Detail content' : undefined}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerEnd}
    onpointercancel={onPointerEnd}
  >
    {#if overlay.type === 'wiki'}
      <Wiki
        initialPath={overlay.path}
        refreshKey={wikiRefreshKey}
        onNavigate={(path) => onWikiNavigate(path)}
        onContextChange={onContextChange}
      />
    {:else if overlay.type === 'email'}
      <Inbox
        initialId={overlay.id}
        targetId={inboxTargetId}
        onNavigate={onInboxNavigate}
        onContextChange={onContextChange}
        onOpenSearch={onOpenSearch}
        onSummarizeInbox={onSummarizeInbox}
      />
    {:else}
      <Calendar
        refreshKey={calendarRefreshKey}
        initialDate={overlay.date}
        onContextChange={onContextChange}
      />
    {/if}
  </div>
</div>

<style>
  .slide-over {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    border-left: 1px solid var(--border);
  }

  .slide-over.mobile-slide {
    will-change: transform;
    touch-action: pan-y;
    overscroll-behavior-x: contain;
  }

  .slide-over.mobile-slide.slide-anim:not(.dragging) {
    transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--accent);
    padding: 4px 8px;
    border-radius: 6px;
    flex-shrink: 0;
  }
  .back-btn:hover {
    background: var(--accent-dim);
  }

  .close-btn-desktop {
    display: none;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    color: var(--text-2);
    border: none;
    border-radius: 6px;
    background: transparent;
    transition: color 0.15s;
  }
  .close-btn-desktop:hover {
    color: var(--text);
  }

  @media (min-width: 768px) {
    .back-btn {
      display: none;
    }
    .close-btn-desktop {
      display: inline-flex;
    }
  }

  .slide-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex: 1;
    min-width: 0;
  }

  .slide-title.slide-title-wiki {
    text-transform: none;
    letter-spacing: normal;
    font-weight: normal;
  }

  .slide-title.slide-title-wiki :global(.wfn-title-row) {
    font-size: 13px;
    color: var(--text);
  }

  .slide-title-email {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }
  .slide-title-email :global(svg) {
    flex-shrink: 0;
    color: var(--text-2);
  }
  .slide-title-email-text {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slide-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .slide-action-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    border-radius: 6px;
    transition: color 0.15s, background 0.15s;
  }
  .slide-action-btn:hover:not(:disabled) { color: var(--text); background: var(--bg-3); }
  .slide-action-btn:disabled { opacity: 0.5; cursor: default; }

  .slide-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .slide-body :global(.wiki),
  .slide-body :global(.inbox),
  .slide-body :global(.calendar) {
    flex: 1;
    min-height: 0;
  }
</style>
