<script lang="ts">
  import { setContext } from 'svelte'
  import {
    Archive,
    Calendar as CalendarIcon,
    Forward,
    Mail,
    Maximize2,
    MessageSquare,
    Minimize2,
    RefreshCw,
    Reply,
    Save,
  } from 'lucide-svelte'
  import Wiki from '../Wiki.svelte'
  import WikiDirList from '../WikiDirList.svelte'
  import FileViewer from '../FileViewer.svelte'
  import Inbox from '../Inbox.svelte'
  import Calendar from '../Calendar.svelte'
  import MessageThread from '../MessageThread.svelte'
  import PhoneAccessPanel from '../PhoneAccessPanel.svelte'
  import YourWikiDetail from '../YourWikiDetail.svelte'
  import HubSourceInspectPanel from '../HubSourceInspectPanel.svelte'
  import HubWikiAboutPanel from '../HubWikiAboutPanel.svelte'
  import HubAddFoldersPanel from '../HubAddFoldersPanel.svelte'
  import WikiFileName from '../WikiFileName.svelte'
  import PaneL2Header from '../PaneL2Header.svelte'
  import type { Overlay } from '@client/lib/router.js'
  import type { SurfaceContext } from '@client/lib/router.js'
  import { shouldDismissMobileSwipe, isInteractiveTarget, swipeDirection } from '@client/lib/slideOverMobile.js'
  import {
    CALENDAR_SLIDE_HEADER,
    type CalendarSlideHeaderState,
  } from '@client/lib/calendarSlideHeaderContext.js'
  import {
    WIKI_SLIDE_HEADER,
    type WikiSlideHeaderState,
  } from '@client/lib/wikiSlideHeaderContext.js'
  import {
    YOUR_WIKI_HEADER,
    type YourWikiHeaderState,
  } from '@client/lib/yourWikiHeaderContext.js'
  import {
    INBOX_THREAD_HEADER,
    type InboxThreadHeaderActions,
    type RegisterInboxThreadHeader,
  } from '@client/lib/inboxSlideHeaderContext.js'
  import { Pause, Play } from 'lucide-svelte'
  import { parseWikiDirSegments, wikiDirPathPrefix } from '@client/lib/wikiDirBreadcrumb.js'

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
    /** Open wiki folder browser (`/wiki-dir/…`). */
    onWikiDirNavigate?: (_dirPath: string | undefined) => void
    onInboxNavigate: (_id: string | undefined) => void
    onContextChange: (_ctx: SurfaceContext) => void
    /** Inbox list: open search, summarize. Thread Reply/Forward/Archive live in the L2 header. */
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
    /** Hub add-folders embedded chat: empty-state “your wiki” help. */
    onOpenWikiAbout?: () => void
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
    onWikiDirNavigate,
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
    onOpenWikiAbout,
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
    if (o.type === 'wiki' || o.type === 'wiki-dir') return 'Docs'
    if (o.type === 'file') return 'File'
    if (o.type === 'email') return 'Inbox'
    if (o.type === 'messages') return 'Messages'
    if (o.type === 'phone-access') return 'Connect Phone'
    if (o.type === 'your-wiki') return 'Your Wiki'
    if (o.type === 'hub-source') return 'Search index source'
    if (o.type === 'hub-add-folders') return 'Add folders to index'
    if (o.type === 'hub-wiki-about') return 'Your wiki'
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

  let yourWikiHeader = $state<YourWikiHeaderState | null>(null)
  function registerYourWikiHeader(state: YourWikiHeaderState | null) {
    yourWikiHeader = state
  }
  setContext(YOUR_WIKI_HEADER, registerYourWikiHeader)

  let inboxThreadHeader = $state<InboxThreadHeaderActions | null>(null)
  const registerInboxThreadHeader: RegisterInboxThreadHeader = (state) => {
    inboxThreadHeader = state
  }
  setContext(INBOX_THREAD_HEADER, registerInboxThreadHeader)
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
      <button type="button" class="back-btn" onclick={onBackOrHeaderClose} aria-label="Back">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m15 18-6-6 6-6"/>
        </svg>
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
              overlay.type === 'wiki-dir' ||
              (overlay.type === 'file' && overlay.path) ||
              (overlay.type === 'email' && emailHeaderTitle) ||
              (overlay.type === 'messages' && messagesHeaderTitle),
          )}
        >
          {#if overlay.type === 'wiki' && overlay.path}
            <WikiFileName path={overlay.path} />
          {:else if overlay.type === 'wiki-dir'}
            {@const wikiDirSegs = parseWikiDirSegments(overlay.path)}
            <span
              class="wiki-dir-breadcrumb"
              role="navigation"
              aria-label="Wiki folder path"
            >
              {#if wikiDirSegs.length === 0}
                <span class="wiki-breadcrumb-seg wiki-breadcrumb-seg--current">My Wiki</span>
              {:else}
                <button
                  type="button"
                  class="wiki-breadcrumb-seg"
                  onclick={() => onWikiDirNavigate?.(undefined)}
                >My Wiki</button>
                {#each wikiDirSegs as seg, i (i)}
                  <span class="wiki-breadcrumb-sep" aria-hidden="true">/</span>
                  {#if i < wikiDirSegs.length - 1}
                    <button
                      type="button"
                      class="wiki-breadcrumb-seg"
                      onclick={() => onWikiDirNavigate?.(wikiDirPathPrefix(wikiDirSegs, i))}
                    >{seg}</button>
                  {:else}
                    <span class="wiki-breadcrumb-seg wiki-breadcrumb-seg--current">{seg}</span>
                  {/if}
                {/each}
              {/if}
            </span>
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
          {:else if overlay.type === 'your-wiki' && yourWikiHeader?.doc}
            <div class="your-wiki-header-center">
              <span class="slide-title">{titleForOverlay(overlay)}</span>
              <div class="your-wiki-status-inline">
                <span class="phase-pill-mini" class:active={['starting', 'enriching', 'cleaning'].includes(yourWikiHeader.doc.phase)}>
                  {yourWikiHeader.doc.phase === 'starting' ? 'Starting' :
                   yourWikiHeader.doc.phase === 'enriching' ? 'Enriching' :
                   yourWikiHeader.doc.phase === 'cleaning' ? 'Cleaning up' :
                   yourWikiHeader.doc.phase === 'paused' ? 'Paused' :
                   yourWikiHeader.doc.phase === 'error' ? 'Error' :
                   'Idle'}
                </span>
                {#if yourWikiHeader.doc.pageCount > 0}
                  <span class="page-count-mini">{yourWikiHeader.doc.pageCount} pages</span>
                {/if}
              </div>
            </div>
          {:else}
            {titleForOverlay(overlay)}
          {/if}
        </span>
      {/if}
    {/snippet}
    {#snippet right()}
      {#if overlay.type === 'your-wiki' && yourWikiHeader}
        <div class="your-wiki-header-actions">
          {#if ['starting', 'enriching', 'cleaning', 'idle'].includes(yourWikiHeader.doc?.phase ?? '') && yourWikiHeader.doc?.phase !== 'paused'}
            <button
              type="button"
              class="header-action-btn"
              disabled={yourWikiHeader.actionBusy}
              onclick={yourWikiHeader.pause}
              title="Pause the wiki loop"
            >
              <Pause size={14} aria-hidden="true" />
            </button>
          {:else if yourWikiHeader.doc?.phase === 'paused' || yourWikiHeader.doc?.phase === 'error'}
            <button
              type="button"
              class="header-action-btn header-action-btn-primary"
              disabled={yourWikiHeader.actionBusy}
              onclick={yourWikiHeader.resume}
              title="Resume the wiki loop"
            >
              <Play size={14} aria-hidden="true" />
            </button>
          {/if}
        </div>
      {/if}
      {#if overlay.type === 'calendar' && calendarHeader}
        <button
          type="button"
          class="cal-header-icon-btn"
          onclick={calendarHeader.goToday}
          disabled={calendarHeader.headerBusy}
          title="Today"
          aria-label="Today"
        >
          <CalendarIcon size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="cal-header-icon-btn"
          onclick={calendarHeader.refreshCalendars}
          disabled={calendarHeader.headerBusy}
          title="Refresh calendars"
          aria-label="Refresh calendars"
        >
          <span class:cal-refresh-spin={calendarHeader.headerBusy}>
            <RefreshCw size={18} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
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
          {#if wikiHeader.pageMode === 'edit'}
            <Save size={15} strokeWidth={2} aria-hidden="true" />
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>
            </svg>
          {/if}
        </button>
      {/if}
      {#if overlay.type === 'email' && inboxThreadHeader}
        <div class="inbox-thread-header-actions" role="toolbar" aria-label="Thread actions">
          <button
            type="button"
            class="inbox-thread-header-btn"
            onclick={() => inboxThreadHeader?.onReply()}
            title="Reply"
            aria-label="Reply"
          >
            <Reply size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="inbox-thread-header-btn"
            onclick={() => inboxThreadHeader?.onForward()}
            title="Forward"
            aria-label="Forward"
          >
            <Forward size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="inbox-thread-header-btn"
            onclick={() => inboxThreadHeader?.onArchive()}
            title="Archive"
            aria-label="Archive thread"
          >
            <Archive size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
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
        onNavigateToDir={onWikiDirNavigate}
        onContextChange={onContextChange}
      />
    {:else if overlay.type === 'wiki-dir'}
      <WikiDirList
        dirPath={overlay.path}
        refreshKey={wikiRefreshKey}
        onOpenFile={(path) => onWikiNavigate(path)}
        onOpenDir={(path) => onWikiDirNavigate?.(path)}
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
    {:else if overlay.type === 'your-wiki'}
      <YourWikiDetail
        onOpenWiki={(path) => {
          if (path) onWikiNavigate(path)
        }}
        onOpenFile={toolOnOpenFile}
        onOpenEmail={toolOnOpenEmail}
        onOpenFullInbox={toolOnOpenFullInbox}
        onSwitchToCalendar={onCalendarNavigate}
        onOpenMessageThread={toolOnOpenMessageThread}
      />
    {:else if overlay.type === 'hub-source'}
      <HubSourceInspectPanel sourceId={overlay.id} onClose={onClose} />
    {:else if overlay.type === 'hub-wiki-about'}
      <HubWikiAboutPanel />
    {:else if overlay.type === 'hub-add-folders'}
      <HubAddFoldersPanel
        onOpenWiki={(path) => {
          if (path) onWikiNavigate(path)
        }}
        onOpenFile={toolOnOpenFile}
        onOpenEmail={toolOnOpenEmail}
        onOpenFullInbox={toolOnOpenFullInbox}
        onSwitchToCalendar={onCalendarNavigate}
        onOpenMessageThread={toolOnOpenMessageThread}
        onOpenWikiAbout={onOpenWikiAbout}
      />
    {:else if overlay.type === 'calendar'}
      <Calendar
        refreshKey={calendarRefreshKey}
        initialDate={overlay.date}
        initialEventId={overlay.eventId}
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
    /* L2 (PaneL2Header): roomier bar + type; --pane-header-* flow into height + inline padding */
    --pane-header-h: 52px;
    --pane-header-px: 16px;
  }

  .slide-over.mobile-slide :global(.pane-l2-header) {
    column-gap: 0.75rem;
  }

  .slide-over.mobile-slide .back-btn {
    font-size: 15px;
    padding: 6px 10px;
  }
  .slide-over.mobile-slide .back-btn :global(svg) {
    width: 22px;
    height: 22px;
  }

  .slide-over.mobile-slide .slide-title {
    font-size: 14px;
  }
  .slide-over.mobile-slide .slide-title.slide-title-wiki :global(.wfn-title-row) {
    font-size: 15px;
  }
  .slide-over.mobile-slide .slide-title.slide-title-wiki :global(.wiki-dir-breadcrumb) {
    font-size: 15px;
  }

  .slide-over.mobile-slide .slide-title-email-text {
    font-size: 15px;
  }
  .slide-over.mobile-slide .slide-title-email :global(svg) {
    width: 20px;
    height: 20px;
  }

  .slide-over.mobile-slide .cal-week-label {
    font-size: 15px;
  }
  .slide-over.mobile-slide .cal-nav-btn {
    width: 40px;
    height: 40px;
    font-size: 18px;
    border-radius: 6px;
  }
  .slide-over.mobile-slide .cal-header-icon-btn {
    width: 40px;
    height: 40px;
    border-radius: 6px;
  }
  .slide-over.mobile-slide .cal-header-icon-btn :global(svg) {
    width: 20px;
    height: 20px;
  }

  .slide-over.mobile-slide .header-action-btn {
    width: 40px;
    height: 40px;
    border-radius: 8px;
  }
  .slide-over.mobile-slide .header-action-btn :global(svg) {
    width: 20px;
    height: 20px;
  }

  .slide-over.mobile-slide .wiki-edit-btn {
    width: 40px;
    height: 40px;
    border-radius: 8px;
  }
  .slide-over.mobile-slide .wiki-edit-btn :global(svg) {
    width: 20px;
    height: 20px;
  }

  .slide-over.mobile-slide .inbox-thread-header-btn {
    width: 40px;
    height: 40px;
    border-radius: 8px;
  }
  .slide-over.mobile-slide .inbox-thread-header-btn :global(svg) {
    width: 20px;
    height: 20px;
  }

  .slide-over.mobile-slide .wiki-save-hint {
    font-size: 13px;
  }

  .slide-over.mobile-slide .your-wiki-header-center {
    gap: 10px;
  }
  .slide-over.mobile-slide .phase-pill-mini {
    font-size: 10px;
    padding: 2px 6px;
  }
  .slide-over.mobile-slide .page-count-mini {
    font-size: 12px;
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

  .inbox-thread-header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .inbox-thread-header-btn {
    display: inline-flex;
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

  .cal-header-icon-btn {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .cal-header-icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cal-refresh-spin :global(svg) {
    animation: cal-refresh-spin 0.8s linear infinite;
  }

  @keyframes cal-refresh-spin {
    to {
      transform: rotate(360deg);
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

  .slide-title.slide-title-wiki :global(.wiki-dir-breadcrumb) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 4px;
    min-width: 0;
    font-size: 13px;
    line-height: 1.35;
  }

  .slide-title.slide-title-wiki :global(.wiki-breadcrumb-sep) {
    color: var(--text-2);
    font-weight: 400;
    user-select: none;
  }

  .slide-title.slide-title-wiki :global(.wiki-breadcrumb-seg) {
    display: inline;
    max-width: 100%;
    font: inherit;
    text-align: inherit;
    text-transform: none;
    letter-spacing: normal;
    color: var(--accent);
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slide-title.slide-title-wiki :global(.wiki-breadcrumb-seg--current) {
    color: var(--text);
    cursor: default;
    font-weight: 500;
  }

  .slide-title-email {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
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

  .your-wiki-header-center {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }

  .your-wiki-status-inline {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .phase-pill-mini {
    font-size: 9px;
    font-weight: 800;
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--bg-3);
    color: var(--text-2);
    white-space: nowrap;
  }

  .phase-pill-mini.active {
    background: var(--accent);
    color: white;
  }

  .page-count-mini {
    font-size: 11px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .your-wiki-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-right: 4px;
  }

  .header-action-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    border-radius: 6px;
    transition: all 0.15s;
  }

  .header-action-btn-primary {
    color: var(--accent);
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
  .wiki-edit-btn:disabled { opacity: 0.35; cursor: default; }
  .wiki-edit-btn.active { color: var(--accent); }

  @media (hover: hover) {
    .back-btn:hover {
      background: var(--accent-dim);
    }
    .close-btn-desktop:hover {
      color: var(--text);
    }
    .inbox-thread-header-btn:hover {
      color: var(--text);
      background: var(--bg-3);
    }
    .fullscreen-btn-desktop:hover {
      color: var(--text);
      background: var(--bg-3);
    }
    .cal-nav-btn:hover {
      color: var(--text);
      background: var(--bg-3);
    }
    .cal-header-icon-btn:hover:not(:disabled) {
      color: var(--text);
      background: var(--bg-3);
    }
    .slide-title.slide-title-wiki
      :global(.wiki-breadcrumb-seg:hover:not(.wiki-breadcrumb-seg--current)) {
      text-decoration: underline;
    }
    .header-action-btn:hover:not(:disabled) {
      color: var(--text);
      background: var(--bg-3);
    }
    .header-action-btn-primary:hover:not(:disabled) {
      background: var(--accent-dim);
      color: var(--accent);
    }
    .wiki-edit-btn:hover:not(:disabled) {
      color: var(--text);
      background: var(--bg-3);
    }
  }

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
  .slide-body :global(.calendar),
  .slide-body :global(.hub-bg-agents-detail),
  .slide-body :global(.hub-source-inspect),
  .slide-body :global(.hub-add-folders-panel) {
    flex: 1;
    min-height: 0;
  }
</style>
