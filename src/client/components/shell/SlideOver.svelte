<script lang="ts">
  import {
    Archive,
    Calendar as CalendarIcon,
    ChevronLeft,
    Forward,
    Loader2,
    Mail,
    Maximize2,
    MessageSquare,
    Minimize2,
    Pause,
    Pencil,
    Play,
    RefreshCw,
    Reply,
    Save,
    Send,
    X,
  } from 'lucide-svelte'
  import Wiki from '../Wiki.svelte'
  import WikiDirList from '../WikiDirList.svelte'
  import FileViewer from '../FileViewer.svelte'
  import Inbox from '../Inbox.svelte'
  import Calendar from '../Calendar.svelte'
  import MessageThread from '../MessageThread.svelte'
  import MailSearchResultsPanel from '../MailSearchResultsPanel.svelte'
  import YourWikiDetail from '../YourWikiDetail.svelte'
  import HubConnectorSourcePanel from '../hub-connector/HubConnectorSourcePanel.svelte'
  import HubWikiAboutPanel from '../HubWikiAboutPanel.svelte'
  import WikiFileName from '../WikiFileName.svelte'
  import EmailDraftEditor from '../EmailDraftEditor.svelte'
  import PaneL2Header from '../PaneL2Header.svelte'
  import type { Overlay, SurfaceContext } from '@client/lib/router.js'
  import type { MailSearchResultsState } from '@client/lib/assistantShellModel.js'
  import { createSlideHeaderRegistration } from '@client/lib/slideHeaderContextRegistration.svelte.js'
  import { createSlideOverMobilePanel } from '@client/lib/slideOverMobilePanel.svelte.js'
  import {
    emailDraftTitleForSlideOver,
    emailThreadTitleForSlideOver,
    messagesTitleForSlideOver,
    titleForOverlay,
  } from '@client/lib/slideOverHeader.js'
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
  } from '@client/lib/inboxSlideHeaderContext.js'
  import {
    EMAIL_DRAFT_HEADER,
    type EmailDraftHeaderActions,
  } from '@client/lib/emailDraftSlideHeaderContext.js'
  import { parseWikiDirSegments, wikiDirPathPrefix } from '@client/lib/wikiDirBreadcrumb.js'

  type Props = {
    overlay: Overlay
    /** From App — used for email subject in header when a thread is open. */
    surfaceContext?: SurfaceContext
    wikiRefreshKey: number
    calendarRefreshKey: number
    inboxTargetId: string | undefined
    mailSearchResults?: MailSearchResultsState | null
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
    /** `?panel=calendar&date=&event=` — same contract as App `switchToCalendar`. */
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
    toolOnOpenDraft?: (_draftId: string, _subject?: string) => void
    toolOnOpenFullInbox?: () => void
    toolOnOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
    /** Reserved for future empty-state hooks (previously used by add-folders panel). */
    onOpenWikiAbout?: () => void
  }

  let {
    overlay,
    surfaceContext = { type: 'chat' } as SurfaceContext,
    wikiRefreshKey,
    calendarRefreshKey,
    inboxTargetId,
    mailSearchResults = null,
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
    toolOnOpenDraft,
    toolOnOpenFullInbox,
    toolOnOpenMessageThread,
    onOpenWikiAbout: _onOpenWikiAbout,
  }: Props = $props()

  const mobile = createSlideOverMobilePanel({
    getMobilePanel: () => mobilePanel,
    getOnClose: () => onClose,
  })

  /** Animated slide off to the right, then `onClose` (for mobile + Escape). */
  export function closeAnimated() {
    mobile.closeAnimated()
  }

  function onBackOrHeaderClose() {
    if (mobilePanel) closeAnimated()
    else onClose()
  }

  /** Folder stems + final segment as full filename (e.g. `projects/index.md` → `projects`, `index.md`). */
  function wikiPageBreadcrumbSegments(path: string): string[] {
    const norm = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')
    if (!norm) return []
    const rawParts = norm.split('/').map((s) => s.trim()).filter((s) => s.length > 0)
    if (rawParts.length === 0) return []
    const dirs = rawParts.slice(0, -1)
    const fileName = rawParts[rawParts.length - 1]!
    const dirSegs = dirs.map((d) => d.replace(/\.md$/i, ''))
    return [...dirSegs, fileName]
  }

  function wikiBreadcrumbLabel(segment: string): string {
    const base = segment.startsWith('_') ? segment.slice(1) : segment
    return base
      .split('-')
      .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
      .join(' ')
  }

  const emailHeaderTitle = $derived(emailThreadTitleForSlideOver(overlay, surfaceContext))
  const emailDraftHeaderTitle = $derived(emailDraftTitleForSlideOver(overlay, surfaceContext))
  const messagesHeaderTitle = $derived(messagesTitleForSlideOver(overlay, surfaceContext))

  const calendarHdr = createSlideHeaderRegistration<CalendarSlideHeaderState>(CALENDAR_SLIDE_HEADER)
  const wikiHdr = createSlideHeaderRegistration<WikiSlideHeaderState>(WIKI_SLIDE_HEADER)
  const yourWikiHdr = createSlideHeaderRegistration<YourWikiHeaderState>(YOUR_WIKI_HEADER)
  const inboxHdr = createSlideHeaderRegistration<InboxThreadHeaderActions>(INBOX_THREAD_HEADER)
  const emailDraftHdr = createSlideHeaderRegistration<EmailDraftHeaderActions>(EMAIL_DRAFT_HEADER)

  /** Back / desktop X: draft uses editor discard (return to thread when applicable). */
  function headerDismiss() {
    if (overlay.type === 'email-draft' && emailDraftHdr.current) {
      emailDraftHdr.current.onDiscard()
      return
    }
    onBackOrHeaderClose()
  }
</script>

<div
  bind:this={mobile.rootEl}
  bind:clientWidth={mobile.panelW}
  class="slide-over"
  class:mobile-slide={mobilePanel}
  class:slide-anim={mobilePanel && mobile.transitionEnabled}
  class:dragging={mobilePanel && mobile.swipeState === 'dragging'}
  data-overlay={overlay.type}
  style:transform={mobilePanel ? `translateX(${mobile.slidePx}px)` : undefined}
  ontransitionend={mobile.onPanelTransitionEnd}
>
  <PaneL2Header>
    {#snippet left()}
      <button
        type="button"
        class="back-btn"
        onclick={headerDismiss}
        aria-label={overlay.type === 'email-draft' && emailDraftHdr.current ? 'Discard draft' : 'Back'}
      >
        {#if overlay.type === 'email-draft' && emailDraftHdr.current}
          <X size={18} strokeWidth={2} aria-hidden="true" />
        {:else}
          <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
        {/if}
      </button>
    {/snippet}
    {#snippet center()}
      {#if overlay.type === 'calendar' && calendarHdr.current}
        <div class="cal-week-inline" aria-label="Week navigation">
          <button
            type="button"
            class="cal-nav-btn"
            onclick={calendarHdr.current.prevWeek}
            aria-label="Previous week"
          >
            &#8592;
          </button>
          <span class="cal-week-label">{calendarHdr.current.weekLabel}</span>
          <button
            type="button"
            class="cal-nav-btn"
            onclick={calendarHdr.current.nextWeek}
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
              (overlay.type === 'email-draft' && emailDraftHeaderTitle) ||
              overlay.type === 'mail-search' ||
              (overlay.type === 'messages' && messagesHeaderTitle),
          )}
        >
          {#if overlay.type === 'wiki' && overlay.path}
            {@const wikiPageSegs = wikiPageBreadcrumbSegments(overlay.path)}
            <span
              class="wiki-dir-breadcrumb"
              role="navigation"
              aria-label="Wiki page path"
            >
              {#if wikiPageSegs.length === 0}
                <span class="wiki-breadcrumb-seg wiki-breadcrumb-seg--current">My Wiki</span>
              {:else}
                <button
                  type="button"
                  class="wiki-breadcrumb-seg"
                  onclick={() => onWikiDirNavigate?.(undefined)}
                >My Wiki</button>
                {#each wikiPageSegs as seg, i (i)}
                  <span class="wiki-breadcrumb-sep" aria-hidden="true">/</span>
                  {#if i < wikiPageSegs.length - 1}
                    <button
                      type="button"
                      class="wiki-breadcrumb-seg"
                      onclick={() => onWikiDirNavigate?.(wikiDirPathPrefix(wikiPageSegs, i))}
                    >{wikiBreadcrumbLabel(seg)}</button>
                  {:else}
                    <span class="wiki-breadcrumb-seg wiki-breadcrumb-seg--current">{wikiBreadcrumbLabel(seg)}</span>
                  {/if}
                {/each}
              {/if}
            </span>
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
          {:else if overlay.type === 'email-draft' && emailDraftHeaderTitle}
            <span class="slide-title-email">
              <Mail size={14} strokeWidth={2} aria-hidden="true" />
              <span class="slide-title-email-text">{emailDraftHeaderTitle}</span>
            </span>
          {:else if overlay.type === 'messages' && messagesHeaderTitle}
            <span class="slide-title-email">
              <MessageSquare size={14} strokeWidth={2} aria-hidden="true" />
              <span class="slide-title-email-text">{messagesHeaderTitle}</span>
            </span>
          {:else if overlay.type === 'your-wiki' && yourWikiHdr.current?.doc}
            <div class="your-wiki-header-center">
              <span class="slide-title">{titleForOverlay(overlay)}</span>
              <div class="your-wiki-status-inline">
                <span class="phase-pill-mini" class:active={['starting', 'enriching', 'cleaning'].includes(yourWikiHdr.current.doc.phase)}>
                  {yourWikiHdr.current.doc.phase === 'starting' ? 'Starting' :
                   yourWikiHdr.current.doc.phase === 'enriching' ? 'Enriching' :
                   yourWikiHdr.current.doc.phase === 'cleaning' ? 'Cleaning up' :
                   yourWikiHdr.current.doc.phase === 'paused' ? 'Paused' :
                   yourWikiHdr.current.doc.phase === 'error' ? 'Error' :
                   'Idle'}
                </span>
                {#if yourWikiHdr.current.doc.pageCount > 0}
                  <span class="page-count-mini">{yourWikiHdr.current.doc.pageCount} pages</span>
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
      {#if overlay.type === 'your-wiki' && yourWikiHdr.current}
        <div class="your-wiki-header-actions">
          {#if ['starting', 'enriching', 'cleaning', 'idle'].includes(yourWikiHdr.current.doc?.phase ?? '') && yourWikiHdr.current.doc?.phase !== 'paused'}
            <button
              type="button"
              class="header-action-btn"
              disabled={yourWikiHdr.current.actionBusy}
              onclick={yourWikiHdr.current.pause}
              title="Pause the wiki loop"
            >
              <Pause size={14} aria-hidden="true" />
            </button>
          {:else if yourWikiHdr.current.doc?.phase === 'paused' || yourWikiHdr.current.doc?.phase === 'error'}
            <button
              type="button"
              class="header-action-btn header-action-btn-primary"
              disabled={yourWikiHdr.current.actionBusy}
              onclick={yourWikiHdr.current.resume}
              title="Resume the wiki loop"
            >
              <Play size={14} aria-hidden="true" />
            </button>
          {/if}
        </div>
      {/if}
      {#if overlay.type === 'calendar' && calendarHdr.current}
        <button
          type="button"
          class="cal-header-icon-btn"
          onclick={calendarHdr.current.goToday}
          disabled={calendarHdr.current.headerBusy}
          title="Today"
          aria-label="Today"
        >
          <CalendarIcon size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="cal-header-icon-btn"
          onclick={calendarHdr.current.refreshCalendars}
          disabled={calendarHdr.current.headerBusy}
          title="Refresh calendars"
          aria-label="Refresh calendars"
        >
          <span class:cal-refresh-spin={calendarHdr.current.headerBusy}>
            <RefreshCw size={18} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
      {/if}
      {#if overlay.type === 'wiki' && wikiHdr.current}
        {#if wikiHdr.current.saveState === 'saving'}
          <span class="wiki-save-hint" role="status">Saving…</span>
        {:else if wikiHdr.current.saveState === 'saved'}
          <span class="wiki-save-hint" role="status">Saved</span>
        {:else if wikiHdr.current.saveState === 'error'}
          <span class="wiki-save-hint wiki-save-err" role="status">Save failed</span>
        {/if}
        <button
          type="button"
          class="wiki-edit-btn"
          class:active={wikiHdr.current.pageMode === 'edit'}
          disabled={!wikiHdr.current.canEdit}
          onclick={() => wikiHdr.current?.setPageMode(wikiHdr.current.pageMode === 'edit' ? 'view' : 'edit')}
          title={wikiHdr.current.pageMode === 'edit' ? 'View' : 'Edit'}
          aria-label={wikiHdr.current.pageMode === 'edit' ? 'Switch to view mode' : 'Switch to edit mode'}
        >
          {#if wikiHdr.current.pageMode === 'edit'}
            <Save size={15} strokeWidth={2} aria-hidden="true" />
          {:else}
            <Pencil size={15} strokeWidth={2} aria-hidden="true" />
          {/if}
        </button>
      {/if}
      {#if overlay.type === 'email' && inboxHdr.current}
        <div class="inbox-thread-header-actions" role="toolbar" aria-label="Thread actions">
          <button
            type="button"
            class="inbox-thread-header-btn"
            onclick={() => inboxHdr.current?.onReply()}
            title="Reply"
            aria-label="Reply"
          >
            <Reply size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="inbox-thread-header-btn"
            onclick={() => inboxHdr.current?.onForward()}
            title="Forward"
            aria-label="Forward"
          >
            <Forward size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            class="inbox-thread-header-btn"
            onclick={() => inboxHdr.current?.onArchive()}
            title="Archive"
            aria-label="Archive thread"
          >
            <Archive size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      {/if}
      {#if overlay.type === 'email-draft' && emailDraftHdr.current}
        <div class="inbox-thread-header-actions" role="toolbar" aria-label="Draft actions">
          {#if emailDraftHdr.current.saveState === 'saving'}
            <span class="wiki-save-hint" role="status">Saving…</span>
          {:else if emailDraftHdr.current.saveState === 'saved'}
            <span class="wiki-save-hint" role="status">Saved</span>
          {:else if emailDraftHdr.current.saveState === 'error'}
            <span class="wiki-save-hint wiki-save-err" role="status">Save failed</span>
          {/if}
          <button
            type="button"
            class="inbox-thread-header-btn"
            onclick={() => void emailDraftHdr.current?.onSave()}
            disabled={
              emailDraftHdr.current.sendState === 'sending' ||
              emailDraftHdr.current.saveState === 'saving'
            }
            title="Save draft"
            aria-label="Save draft"
          >
            {#if emailDraftHdr.current.saveState === 'saving'}
              <span class="cal-refresh-spin" aria-hidden="true">
                <Loader2 size={18} strokeWidth={2} />
              </span>
            {:else}
              <Save size={18} strokeWidth={2} aria-hidden="true" />
            {/if}
          </button>
          <button
            type="button"
            class="inbox-thread-header-btn"
            onclick={() => void emailDraftHdr.current?.onSend()}
            disabled={
              emailDraftHdr.current.sendState === 'sending' ||
              emailDraftHdr.current.saveState === 'saving'
            }
            title="Send"
            aria-label="Send"
          >
            {#if emailDraftHdr.current.sendState === 'sending'}
              <span class="cal-refresh-spin" aria-hidden="true">
                <Loader2 size={18} strokeWidth={2} />
              </span>
            {:else}
              <Send size={18} strokeWidth={2} aria-hidden="true" />
            {/if}
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
      <button
        type="button"
        class="close-btn-desktop"
        onclick={headerDismiss}
        aria-label={overlay.type === 'email-draft' && emailDraftHdr.current ? 'Discard draft' : 'Close panel'}
        title={overlay.type === 'email-draft' && emailDraftHdr.current ? 'Discard draft' : 'Close'}
      >
        <X size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    {/snippet}
  </PaneL2Header>
  <div
    class="slide-body"
    bind:this={mobile.slideBodyEl}
    role={mobilePanel ? 'region' : undefined}
    aria-label={mobilePanel ? 'Detail content' : undefined}
    onpointerdown={mobile.onPointerDown}
    onpointermove={mobile.onPointerMove}
    onpointerup={mobile.onPointerEnd}
    onpointercancel={mobile.onPointerEnd}
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
    {:else if overlay.type === 'email-draft'}
      <EmailDraftEditor
        draftId={overlay.id}
        onContextChange={onContextChange}
        onReturnToThread={(mid) => onInboxNavigate(mid)}
        onClosePanel={onClose}
      />
    {:else if overlay.type === 'mail-search'}
      <MailSearchResultsPanel
        queryLine={mailSearchResults?.queryLine ?? overlay.query ?? 'Mail search'}
        items={mailSearchResults?.items ?? null}
        totalMatched={mailSearchResults?.totalMatched}
        onOpenEmail={toolOnOpenEmail}
      />
    {:else if overlay.type === 'messages'}
      <MessageThread initialChat={overlay.chat} onContextChange={onContextChange} />
    {:else if overlay.type === 'your-wiki'}
      <YourWikiDetail
        onOpenWiki={(path) => {
          if (path) onWikiNavigate(path)
        }}
        onOpenFile={toolOnOpenFile}
        onOpenEmail={toolOnOpenEmail}
        onOpenDraft={toolOnOpenDraft}
        onOpenFullInbox={toolOnOpenFullInbox}
        onSwitchToCalendar={onCalendarNavigate}
        onOpenMessageThread={toolOnOpenMessageThread}
      />
    {:else if overlay.type === 'hub-source'}
      <HubConnectorSourcePanel sourceId={overlay.id} onClose={onClose} />
    {:else if overlay.type === 'hub-wiki-about'}
      <HubWikiAboutPanel />
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
    outline: none;
    transition: color 0.15s, background 0.15s;
  }

  .inbox-thread-header-btn:focus:not(:focus-visible) {
    background: transparent;
    color: var(--text-2);
  }

  .inbox-thread-header-btn:focus-visible {
    color: var(--text);
    background: var(--bg-3);
  }

  .inbox-thread-header-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
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
    outline: none;
    transition: color 0.15s, background 0.15s;
  }

  .fullscreen-btn-desktop:focus:not(:focus-visible) {
    background: transparent;
    color: var(--text-2);
  }

  .fullscreen-btn-desktop:focus-visible {
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
    .inbox-thread-header-btn:hover:not(:disabled) {
      color: var(--text);
      background: var(--bg-3);
    }
    .fullscreen-btn-desktop:hover:not(:disabled) {
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
  .slide-body :global(.mail-search-panel),
  .slide-body :global(.hub-bg-agents-detail),
  .slide-body :global(.hub-connector-source) {
    flex: 1;
    min-height: 0;
  }
</style>
