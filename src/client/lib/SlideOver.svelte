<script lang="ts">
  import { setContext } from 'svelte'
  import { Mail, Maximize2, MessageSquare, Minimize2 } from 'lucide-svelte'
  import Wiki from './Wiki.svelte'
  import FileViewer from './FileViewer.svelte'
  import Inbox from './Inbox.svelte'
  import Calendar from './Calendar.svelte'
  import MessageThread from './MessageThread.svelte'
  import PhoneAccessPanel from './PhoneAccessPanel.svelte'
  import BackgroundAgentPanel from './statusBar/BackgroundAgentPanel.svelte'
  import WikiFileName from './WikiFileName.svelte'
  import PaneL2Header from './PaneL2Header.svelte'
  import type { Overlay } from '../router.js'
  import type { SurfaceContext } from '../router.js'
  import { shouldDismissMobileSwipe, isInteractiveTarget, swipeDirection } from './slideOverMobile.js'
  import {
    CALENDAR_SLIDE_HEADER,
    type CalendarSlideHeaderState,
  } from './calendarSlideHeaderContext.js'
  import {
    WIKI_SLIDE_HEADER,
    type WikiSlideHeaderState,
  } from './wikiSlideHeaderContext.js'

  type Props = {
    overlay: Overlay
    /** From App — used for email subject in header when a thread is open. */
    surfaceContext?: SurfaceContext
    wikiRefreshKey: number
    calendarRefreshKey: number
    inboxTargetId: string | undefined
    /** Live agent `write` stream — markdown body for `path` (wiki pane). */
    wikiStreamingWrite?: { path: string; body: string } | null
    /** Live agent `edit` stream — show “Editing…” for `path` (wiki pane). */
    wikiStreamingEdit?: { path: string; toolId: string } | null
    onWikiNavigate: (_path: string | undefined) => void
    onInboxNavigate: (_id: string | undefined) => void
    onContextChange: (_ctx: SurfaceContext) => void
    /** Passed to Inbox for in-pane actions — not rendered in the L2 header. */
    onOpenSearch?: () => void
    onSummarizeInbox?: (_message: string) => void
    /** Calendar “Today”: jump to this week + clear `event=` in URL. */
    onCalendarResetToToday?: () => void
    /** `/calendar?date=&event=` — same contract as App `switchToCalendar`. */
    onCalendarNavigate?: (_date: string, _eventId?: string) => void
    onClose: () => void
    /** Full-screen mobile stack: slide in from right, swipe from left edge / animated close. */
    mobilePanel?: boolean
    /** Desktop detail pane: expanded to fill workspace (from WorkspaceSplit). */
    detailFullscreen?: boolean
    /** Desktop only: toggle detail fullscreen (parent calls WorkspaceSplit.toggleDetailFullscreen). */
    onToggleFullscreen?: () => void
    /** Background-agent panel: same navigations as ToolCallBlock / chat tool previews. */
    toolOnOpenFile?: (_path: string) => void
    toolOnOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    toolOnOpenFullInbox?: () => void
    toolOnOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
  }

  let {
    overlay,
    surfaceContext = { type: 'chat' } as SurfaceContext,
    wikiRefreshKey,
    calendarRefreshKey,
    inboxTargetId,
    wikiStreamingWrite = null,
    wikiStreamingEdit = null,
    onWikiNavigate,
    onInboxNavigate,
    onContextChange,
    onOpenSearch,
    onSummarizeInbox,
    onCalendarResetToToday,
    onCalendarNavigate,
    onClose,
    mobilePanel = false,
    detailFullscreen = false,
    onToggleFullscreen,
    toolOnOpenFile,
    toolOnOpenEmail,
    toolOnOpenFullInbox,
    toolOnOpenMessageThread,
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

  const messagesHeaderTitle = $derived.by((): string | null => {
    if (overlay.type !== 'messages' || !overlay.chat) return null
    if (surfaceContext.type !== 'messages') return null
    if (surfaceContext.chat !== overlay.chat) return null
    const s = surfaceContext.displayLabel?.trim()
    if (!s || s === '(loading)') return null
    return s
  })

  function titleForOverlay(o: Overlay): string {
    if (o.type === 'wiki') return 'Docs'
    if (o.type === 'file') return 'File'
    if (o.type === 'email') return 'Inbox'
    if (o.type === 'messages') return 'Messages'
    if (o.type === 'phone-access') return 'Connect Phone'
    if (o.type === 'background-agent') return 'Wiki expansion'
    return 'Calendar'
  }

  let calendarHeader = $state<CalendarSlideHeaderState | null>(null)
  function registerCalendarHeader(state: CalendarSlideHeaderState | null) {
    calendarHeader = state
  }
  setContext(CALENDAR_SLIDE_HEADER, registerCalendarHeader)

  let wikiHeader = $state<WikiSlideHeaderState | null>(null)
  function registerWikiHeader(state: WikiSlideHeaderState | null) {
    wikiHeader = state
  }
  setContext(WIKI_SLIDE_HEADER, registerWikiHeader)
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
      {#if overlay.type === 'calendar' && calendarHeader}
        <div class="cal-week-inline" aria-label="Week navigation">
          <button
            type="button"
            class="cal-nav-btn"
            onclick={calendarHeader.prevWeek}
            aria-label="Previous week"
          >
            &#8592;
          </button>
          <span class="cal-week-label">{calendarHeader.weekLabel}</span>
          <button
            type="button"
            class="cal-nav-btn"
            onclick={calendarHeader.nextWeek}
            aria-label="Next week"
          >
            &#8594;
          </button>
        </div>
      {:else}
        <span
          class="slide-title"
          class:slide-title-wiki={Boolean(
            (overlay.type === 'wiki' && overlay.path) ||
              (overlay.type === 'file' && overlay.path) ||
              (overlay.type === 'email' && emailHeaderTitle) ||
              (overlay.type === 'messages' && messagesHeaderTitle),
          )}
        >
          {#if overlay.type === 'wiki' && overlay.path}
            <WikiFileName path={overlay.path} />
          {:else if overlay.type === 'file' && overlay.path}
            <WikiFileName path={overlay.path} />
          {:else if overlay.type === 'email' && emailHeaderTitle}
            <span class="slide-title-email">
              <Mail size={14} strokeWidth={2} aria-hidden="true" />
              <span class="slide-title-email-text">{emailHeaderTitle}</span>
            </span>
          {:else if overlay.type === 'messages' && messagesHeaderTitle}
            <span class="slide-title-email">
              <MessageSquare size={14} strokeWidth={2} aria-hidden="true" />
              <span class="slide-title-email-text">{messagesHeaderTitle}</span>
            </span>
          {:else}
            {titleForOverlay(overlay)}
          {/if}
        </span>
      {/if}
    {/snippet}
    {#snippet right()}
      {#if overlay.type === 'calendar' && calendarHeader}
        <button type="button" class="calendar-today-btn" onclick={calendarHeader.goToday}>Today</button>
      {/if}
      {#if overlay.type === 'wiki' && wikiHeader}
        {#if wikiHeader.saveState === 'saving'}
          <span class="wiki-save-hint" role="status">Saving…</span>
        {:else if wikiHeader.saveState === 'saved'}
          <span class="wiki-save-hint" role="status">Saved</span>
        {:else if wikiHeader.saveState === 'error'}
          <span class="wiki-save-hint wiki-save-err" role="status">Save failed</span>
        {/if}
        <button
          type="button"
          class="wiki-edit-btn"
          class:active={wikiHeader.pageMode === 'edit'}
          disabled={!wikiHeader.canEdit}
          onclick={() => wikiHeader?.setPageMode(wikiHeader.pageMode === 'edit' ? 'view' : 'edit')}
          title={wikiHeader.pageMode === 'edit' ? 'View' : 'Edit'}
          aria-label={wikiHeader.pageMode === 'edit' ? 'Switch to view mode' : 'Switch to edit mode'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>
          </svg>
        </button>
      {/if}
      {#if !mobilePanel && onToggleFullscreen}
        <button
          type="button"
          class="fullscreen-btn-desktop"
          onclick={onToggleFullscreen}
          title={detailFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={detailFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {#if detailFullscreen}
            <Minimize2 size={18} strokeWidth={2} aria-hidden="true" />
          {:else}
            <Maximize2 size={18} strokeWidth={2} aria-hidden="true" />
          {/if}
        </button>
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
        streamingWrite={wikiStreamingWrite}
        streamingEdit={wikiStreamingEdit}
        onNavigate={(path) => onWikiNavigate(path)}
        onContextChange={onContextChange}
      />
    {:else if overlay.type === 'file'}
      <FileViewer initialPath={overlay.path} onContextChange={onContextChange} />
    {:else if overlay.type === 'email'}
      <Inbox
        initialId={overlay.id}
        targetId={inboxTargetId}
        onNavigate={onInboxNavigate}
        onContextChange={onContextChange}
        onOpenSearch={onOpenSearch}
        onSummarizeInbox={onSummarizeInbox}
      />
    {:else if overlay.type === 'messages'}
      <MessageThread initialChat={overlay.chat} onContextChange={onContextChange} />
    {:else if overlay.type === 'phone-access'}
      <PhoneAccessPanel />
    {:else if overlay.type === 'background-agent'}
      <BackgroundAgentPanel
        id={overlay.id}
        onOpenWiki={(path) => {
          if (path) onWikiNavigate(path)
        }}
        onOpenFile={toolOnOpenFile}
        onOpenEmail={toolOnOpenEmail}
        onOpenFullInbox={toolOnOpenFullInbox}
        onSwitchToCalendar={onCalendarNavigate}
        onOpenMessageThread={toolOnOpenMessageThread}
      />
    {:else}
      <Calendar
        refreshKey={calendarRefreshKey}
        initialDate={overlay.type === 'calendar' ? overlay.date : undefined}
        initialEventId={overlay.type === 'calendar' ? overlay.eventId : undefined}
        onResetToToday={onCalendarResetToToday}
        onCalendarNavigate={onCalendarNavigate}
        onContextChange={onContextChange}
        onOpenWiki={(path) => {
          if (path) onWikiNavigate(path)
        }}
        onOpenEmail={(id) => {
          if (id) onInboxNavigate(id)
        }}
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

  .fullscreen-btn-desktop {
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
    transition: color 0.15s, background 0.15s;
  }
  .fullscreen-btn-desktop:hover {
    color: var(--text);
    background: var(--bg-3);
  }

  @media (min-width: 768px) {
    .back-btn {
      display: none;
    }
    .fullscreen-btn-desktop {
      display: inline-flex;
    }
    .close-btn-desktop {
      display: inline-flex;
    }
  }

  .cal-week-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .cal-week-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    min-width: 0;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cal-nav-btn {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 4px;
    font-size: 16px;
    color: var(--text-2);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cal-nav-btn:hover {
    color: var(--text);
    background: var(--bg-3);
  }

  .calendar-today-btn {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid var(--border);
    color: var(--text-2);
    flex-shrink: 0;
  }

  .calendar-today-btn:hover {
    color: var(--text);
    border-color: var(--text-2);
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

  .wiki-edit-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    border-radius: 6px;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
  }
  .wiki-edit-btn:hover:not(:disabled) { color: var(--text); background: var(--bg-3); }
  .wiki-edit-btn:disabled { opacity: 0.35; cursor: default; }
  .wiki-edit-btn.active { color: var(--accent); }

  .wiki-save-hint {
    font-size: 12px;
    color: var(--text-2);
    flex-shrink: 0;
  }
  .wiki-save-err {
    color: var(--danger, #c44);
  }

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
