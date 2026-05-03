<script lang="ts">
  import {
    Archive,
    FileText,
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
    Share2,
    X,
  } from 'lucide-svelte'
  import Wiki from '@components/Wiki.svelte'
  import WikiDirList from '@components/WikiDirList.svelte'
  import FileViewer from '@components/FileViewer.svelte'
  import IndexedFileViewer from '@components/IndexedFileViewer.svelte'
  import Inbox from '@components/Inbox.svelte'
  import Calendar from '@components/Calendar.svelte'
  import MessageThread from '@components/MessageThread.svelte'
  import MailSearchResultsPanel from '@components/MailSearchResultsPanel.svelte'
  import YourWikiDetail from '@components/YourWikiDetail.svelte'
  import HubConnectorSourcePanel from '@components/hub-connector/HubConnectorSourcePanel.svelte'
  import HubWikiAboutPanel from '@components/HubWikiAboutPanel.svelte'
  import WikiFileName from '@components/WikiFileName.svelte'
  import EmailDraftEditor from '@components/EmailDraftEditor.svelte'
  import PaneL2Header from '@components/PaneL2Header.svelte'
  import { cn } from '@client/lib/cn.js'
  import type { Overlay, SurfaceContext } from '@client/lib/router.js'
  import type { MailSearchResultsState } from '@client/lib/assistantShellModel.js'
  import { createSlideHeaderRegistration } from '@client/lib/slideHeaderContextRegistration.svelte.js'
  import { createSlideOverMobilePanel } from '@client/lib/slideOverMobilePanel.svelte.js'
  import {
    emailDraftTitleForSlideOver,
    emailThreadTitleForSlideOver,
    indexedFileTitleForSlideOver,
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
  import {
    HUB_SOURCE_SLIDE_HEADER,
    type HubSourceSlideHeaderState,
  } from '@client/lib/hubSourceSlideHeaderContext.js'
  import { parseWikiDirSegments, wikiDirPathPrefix } from '@client/lib/wikiDirBreadcrumb.js'

  function wikiShareAudienceBadge(n: number | undefined): string {
    const c = n ?? 0
    return c > 9 ? '9+' : `${c}`
  }

  function wikiSlideShareTitle(hdr: WikiSlideHeaderState): string {
    const n = hdr.shareAudienceCount ?? 0
    return n > 0 ? `Shared with ${n} people — manage access` : 'Share'
  }

  function wikiSlideShareAria(hdr: WikiSlideHeaderState): string {
    const n = hdr.shareAudienceCount ?? 0
    return n > 0 ? `Shared with ${n} people; manage access.` : 'Share'
  }

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
    /** Live agent `edit` stream — show "Editing…" for `path` (wiki pane). */
    wikiStreamingEdit?: { path: string; toolId: string } | null
    onWikiNavigate: (_path: string | undefined) => void
    /** Open wiki folder browser (`/wiki-dir/…`). */
    onWikiDirNavigate?: (_dirPath: string | undefined) => void
    /** Navigate into an accepted directory share (grantee). */
    onOpenSharedWiki?: (_p: { ownerId: string; pathPrefix: string }) => void
    onOpenSharedWikiFile?: (_p: { ownerId: string; filePath: string }) => void
    onInboxNavigate: (_id: string | undefined) => void
    onContextChange: (_ctx: SurfaceContext) => void
    /** Inbox list: open search, summarize. Thread Reply/Forward/Archive live in the L2 header. */
    onOpenSearch?: () => void
    onSummarizeInbox?: (_message: string) => void
    /** Calendar "Today": jump to this week + clear `event=` in URL. */
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
    toolOnOpenIndexedFile?: (_id: string, _source?: string) => void
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
    onOpenSharedWiki,
    onOpenSharedWikiFile,
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
    toolOnOpenIndexedFile,
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
  const indexedFileHeaderTitle = $derived(indexedFileTitleForSlideOver(overlay, surfaceContext))

  const calendarHdr = createSlideHeaderRegistration<CalendarSlideHeaderState>(CALENDAR_SLIDE_HEADER)
  const wikiHdr = createSlideHeaderRegistration<WikiSlideHeaderState>(WIKI_SLIDE_HEADER)
  const yourWikiHdr = createSlideHeaderRegistration<YourWikiHeaderState>(YOUR_WIKI_HEADER)
  const inboxHdr = createSlideHeaderRegistration<InboxThreadHeaderActions>(INBOX_THREAD_HEADER)
  const emailDraftHdr = createSlideHeaderRegistration<EmailDraftHeaderActions>(EMAIL_DRAFT_HEADER)
  const hubSourceHdr = createSlideHeaderRegistration<HubSourceSlideHeaderState>(HUB_SOURCE_SLIDE_HEADER)

  /** Back / desktop X: draft uses editor discard (return to thread when applicable). */
  function headerDismiss() {
    if (overlay.type === 'email-draft' && emailDraftHdr.current) {
      emailDraftHdr.current.onDiscard()
      return
    }
    onBackOrHeaderClose()
  }

  // Tailwind utility shortcuts
  const headerIconBtnBase =
    'inline-flex h-7 w-7 max-md:h-10 max-md:w-10 shrink-0 items-center justify-center border-none bg-transparent text-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50 hover:enabled:bg-surface-3 hover:enabled:text-foreground [&_svg]:max-md:h-5 [&_svg]:max-md:w-5'

  const wikiEditBtn =
    'wiki-edit-btn flex h-8 w-8 max-md:h-10 max-md:w-10 shrink-0 items-center justify-center text-muted transition-colors disabled:cursor-default disabled:opacity-35 hover:enabled:bg-surface-3 hover:enabled:text-foreground [&_svg]:max-md:h-5 [&_svg]:max-md:w-5'

  const inboxThreadHeaderBtn =
    'inbox-thread-header-btn inline-flex h-8 w-8 max-md:h-10 max-md:w-10 shrink-0 items-center justify-center border-none bg-transparent text-muted outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-45 focus-visible:bg-surface-3 focus-visible:text-foreground hover:enabled:bg-surface-3 hover:enabled:text-foreground [&_svg]:max-md:h-5 [&_svg]:max-md:w-5'
</script>

<div
  bind:this={mobile.rootEl}
  bind:clientWidth={mobile.panelW}
  class={cn(
    'slide-over flex h-full min-h-0 flex-col bg-surface border-l border-border',
    mobilePanel && 'mobile-slide [will-change:transform] [touch-action:pan-y] [overscroll-behavior-x:contain] [--pane-header-h:52px] [--pane-header-px:16px] [&_.pane-l2-header]:[column-gap:0.75rem]',
    mobilePanel && mobile.transitionEnabled && 'slide-anim',
    mobilePanel && mobile.swipeState === 'dragging' && 'dragging',
  )}
  data-overlay={overlay.type}
  style:transform={mobilePanel ? `translateX(${mobile.slidePx}px)` : undefined}
  ontransitionend={mobile.onPanelTransitionEnd}
>
  <PaneL2Header>
    {#snippet left()}
      <button
        type="button"
        class={cn(
          'back-btn inline-flex shrink-0 items-center gap-1 px-2 py-1 text-[13px] text-accent md:hidden',
          'hover:bg-accent-dim',
          mobilePanel && 'text-[15px] px-2.5 py-1.5 [&_svg]:h-[22px] [&_svg]:w-[22px]',
        )}
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
        <div class="cal-week-inline flex flex-1 min-w-0 items-center justify-center gap-2" aria-label="Week navigation">
          <button
            type="button"
            class={cn(
              'cal-nav-btn flex h-7 w-7 max-md:h-10 max-md:w-10 max-md:text-lg shrink-0 items-center justify-center text-base text-muted hover:bg-surface-3 hover:text-foreground',
            )}
            onclick={calendarHdr.current.prevWeek}
            aria-label="Previous week"
          >
            &#8592;
          </button>
          <span class={cn(
            'cal-week-label min-w-0 truncate text-center text-[13px] font-semibold text-foreground',
            mobilePanel && 'text-[15px]',
          )}>{calendarHdr.current.weekLabel}</span>
          <button
            type="button"
            class={cn(
              'cal-nav-btn flex h-7 w-7 max-md:h-10 max-md:w-10 max-md:text-lg shrink-0 items-center justify-center text-base text-muted hover:bg-surface-3 hover:text-foreground',
            )}
            onclick={calendarHdr.current.nextWeek}
            aria-label="Next week"
          >
            &#8594;
          </button>
        </div>
      {:else}
        <span
          class={cn(
            'slide-title flex-1 min-w-0 text-xs font-semibold uppercase tracking-wider text-muted',
            ((overlay.type === 'wiki' && overlay.path) ||
              overlay.type === 'wiki-dir' ||
              (overlay.type === 'file' && overlay.path) ||
              (overlay.type === 'indexed-file' && indexedFileHeaderTitle) ||
              (overlay.type === 'email' && emailHeaderTitle) ||
              (overlay.type === 'email-draft' && emailDraftHeaderTitle) ||
              overlay.type === 'mail-search' ||
              (overlay.type === 'messages' && messagesHeaderTitle))
              && 'slide-title-wiki normal-case font-normal tracking-normal',
            mobilePanel && 'text-sm',
          )}
        >
          {#if overlay.type === 'wiki' && overlay.path}
            {@const wikiPageSegs = wikiPageBreadcrumbSegments(overlay.path)}
            <span
              class={cn(
                'wiki-dir-breadcrumb flex flex-wrap items-center min-w-0 gap-x-1 gap-y-0 leading-snug',
                mobilePanel ? 'text-[15px]' : 'text-[13px]',
              )}
              role="navigation"
              aria-label="Wiki page path"
            >
              {#if wikiPageSegs.length === 0}
                <span class="wiki-breadcrumb-seg wiki-breadcrumb-seg--current text-foreground font-medium cursor-default">My Wiki</span>
              {:else}
                <button
                  type="button"
                  class="wiki-breadcrumb-seg inline max-w-full overflow-hidden text-ellipsis whitespace-nowrap border-none bg-transparent p-0 m-0 normal-case tracking-normal text-accent hover:underline cursor-pointer"
                  onclick={() => onWikiDirNavigate?.(undefined)}
                >My Wiki</button>
                {#each wikiPageSegs as seg, i (i)}
                  <span class="wiki-breadcrumb-sep text-muted font-normal select-none" aria-hidden="true">/</span>
                  {#if i < wikiPageSegs.length - 1}
                    <button
                      type="button"
                      class="wiki-breadcrumb-seg inline max-w-full overflow-hidden text-ellipsis whitespace-nowrap border-none bg-transparent p-0 m-0 normal-case tracking-normal text-accent hover:underline cursor-pointer"
                      onclick={() => onWikiDirNavigate?.(wikiDirPathPrefix(wikiPageSegs, i))}
                    >{wikiBreadcrumbLabel(seg)}</button>
                  {:else}
                    <span class="wiki-breadcrumb-seg wiki-breadcrumb-seg--current text-foreground font-medium cursor-default">{wikiBreadcrumbLabel(seg)}</span>
                  {/if}
                {/each}
              {/if}
            </span>
          {:else if overlay.type === 'wiki-dir'}
            {@const wikiDirSegs = parseWikiDirSegments(overlay.path)}
            <span
              class={cn(
                'wiki-dir-breadcrumb flex flex-wrap items-center min-w-0 gap-x-1 gap-y-0 leading-snug',
                mobilePanel ? 'text-[15px]' : 'text-[13px]',
              )}
              role="navigation"
              aria-label="Wiki folder path"
            >
              {#if wikiDirSegs.length === 0}
                <span class="wiki-breadcrumb-seg wiki-breadcrumb-seg--current text-foreground font-medium cursor-default">My Wiki</span>
              {:else}
                <button
                  type="button"
                  class="wiki-breadcrumb-seg inline max-w-full overflow-hidden text-ellipsis whitespace-nowrap border-none bg-transparent p-0 m-0 normal-case tracking-normal text-accent hover:underline cursor-pointer"
                  onclick={() => onWikiDirNavigate?.(undefined)}
                >My Wiki</button>
                {#each wikiDirSegs as seg, i (i)}
                  <span class="wiki-breadcrumb-sep text-muted font-normal select-none" aria-hidden="true">/</span>
                  {#if i < wikiDirSegs.length - 1}
                    <button
                      type="button"
                      class="wiki-breadcrumb-seg inline max-w-full overflow-hidden text-ellipsis whitespace-nowrap border-none bg-transparent p-0 m-0 normal-case tracking-normal text-accent hover:underline cursor-pointer"
                      onclick={() => onWikiDirNavigate?.(wikiDirPathPrefix(wikiDirSegs, i))}
                    >{seg}</button>
                  {:else}
                    <span class="wiki-breadcrumb-seg wiki-breadcrumb-seg--current text-foreground font-medium cursor-default">{seg}</span>
                  {/if}
                {/each}
              {/if}
            </span>
          {:else if overlay.type === 'file' && overlay.path}
            <WikiFileName path={overlay.path} />
          {:else if overlay.type === 'indexed-file' && overlay.id && indexedFileHeaderTitle}
            <span class="slide-title-email flex flex-1 min-w-0 items-center gap-2 overflow-hidden">
              <FileText size={mobilePanel ? 20 : 14} strokeWidth={2} aria-hidden="true" class="shrink-0 text-muted" />
              <span class={cn('slide-title-email-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground', mobilePanel ? 'text-[15px]' : 'text-[13px]')}>{indexedFileHeaderTitle}</span>
            </span>
          {:else if overlay.type === 'email' && emailHeaderTitle}
            <span class="slide-title-email flex flex-1 min-w-0 items-center gap-2 overflow-hidden">
              <Mail size={mobilePanel ? 20 : 14} strokeWidth={2} aria-hidden="true" class="shrink-0 text-muted" />
              <span class={cn('slide-title-email-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground', mobilePanel ? 'text-[15px]' : 'text-[13px]')}>{emailHeaderTitle}</span>
            </span>
          {:else if overlay.type === 'email-draft' && emailDraftHeaderTitle}
            <span class="slide-title-email flex flex-1 min-w-0 items-center gap-2 overflow-hidden">
              <Mail size={mobilePanel ? 20 : 14} strokeWidth={2} aria-hidden="true" class="shrink-0 text-muted" />
              <span class={cn('slide-title-email-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground', mobilePanel ? 'text-[15px]' : 'text-[13px]')}>{emailDraftHeaderTitle}</span>
            </span>
          {:else if overlay.type === 'messages' && messagesHeaderTitle}
            <span class="slide-title-email flex flex-1 min-w-0 items-center gap-2 overflow-hidden">
              <MessageSquare size={mobilePanel ? 20 : 14} strokeWidth={2} aria-hidden="true" class="shrink-0 text-muted" />
              <span class={cn('slide-title-email-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground', mobilePanel ? 'text-[15px]' : 'text-[13px]')}>{messagesHeaderTitle}</span>
            </span>
          {:else if overlay.type === 'your-wiki' && yourWikiHdr.current?.doc}
            <div class="your-wiki-header-center flex flex-1 min-w-0 items-center gap-3">
              <span class="slide-title">{titleForOverlay(overlay)}</span>
              <div class="your-wiki-status-inline flex shrink-0 items-center gap-2">
                <span class={cn(
                  'phase-pill-mini whitespace-nowrap bg-surface-3 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider text-muted',
                  mobilePanel && 'text-[10px] px-1.5 py-0.5',
                  ['starting', 'enriching', 'cleaning'].includes(yourWikiHdr.current.doc.phase) && 'bg-accent text-white',
                )}>
                  {yourWikiHdr.current.doc.phase === 'starting' ? 'Starting' :
                   yourWikiHdr.current.doc.phase === 'enriching' ? 'Enriching' :
                   yourWikiHdr.current.doc.phase === 'cleaning' ? 'Cleaning up' :
                   yourWikiHdr.current.doc.phase === 'paused' ? 'Paused' :
                   yourWikiHdr.current.doc.phase === 'error' ? 'Error' :
                   'Idle'}
                </span>
                {#if yourWikiHdr.current.doc.pageCount > 0}
                  <span class={cn('page-count-mini whitespace-nowrap text-muted [font-variant-numeric:tabular-nums]', mobilePanel ? 'text-xs' : 'text-[11px]')}>{yourWikiHdr.current.doc.pageCount} pages</span>
                {/if}
              </div>
            </div>
          {:else if overlay.type === 'hub-source'}
            <span class={cn(
              'slide-title slide-title-hub-source whitespace-nowrap overflow-hidden text-ellipsis normal-case font-bold text-foreground',
              mobilePanel ? 'text-base' : 'text-[15px]',
              '[letter-spacing:-0.02em]',
            )}>
              {hubSourceHdr.current?.title?.trim() ? hubSourceHdr.current.title : titleForOverlay(overlay)}
            </span>
          {:else}
            {titleForOverlay(overlay)}
          {/if}
        </span>
      {/if}
    {/snippet}
    {#snippet right()}
      {#if overlay.type === 'your-wiki' && yourWikiHdr.current}
        <div class="your-wiki-header-actions mr-1 flex items-center gap-1">
          {#if ['starting', 'enriching', 'cleaning', 'idle'].includes(yourWikiHdr.current.doc?.phase ?? '') && yourWikiHdr.current.doc?.phase !== 'paused'}
            <button
              type="button"
              class={cn('header-action-btn flex h-7 w-7 max-md:h-10 max-md:w-10 items-center justify-center text-muted transition-colors hover:enabled:bg-surface-3 hover:enabled:text-foreground [&_svg]:max-md:h-5 [&_svg]:max-md:w-5')}
              disabled={yourWikiHdr.current.actionBusy}
              onclick={yourWikiHdr.current.pause}
              title="Pause the wiki loop"
            >
              <Pause size={14} aria-hidden="true" />
            </button>
          {:else if yourWikiHdr.current.doc?.phase === 'paused' || yourWikiHdr.current.doc?.phase === 'error'}
            <button
              type="button"
              class={cn('header-action-btn header-action-btn-primary flex h-7 w-7 max-md:h-10 max-md:w-10 items-center justify-center text-accent transition-colors hover:enabled:bg-accent-dim hover:enabled:text-accent [&_svg]:max-md:h-5 [&_svg]:max-md:w-5')}
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
          class={cn('cal-header-icon-btn', headerIconBtnBase)}
          onclick={calendarHdr.current.goToday}
          disabled={calendarHdr.current.headerBusy}
          title="Today"
          aria-label="Today"
        >
          <CalendarIcon size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          class={cn('cal-header-icon-btn', headerIconBtnBase)}
          onclick={calendarHdr.current.refreshCalendars}
          disabled={calendarHdr.current.headerBusy}
          title="Refresh calendars"
          aria-label="Refresh calendars"
        >
          <span class={calendarHdr.current.headerBusy ? 'cal-refresh-spin' : ''}>
            <RefreshCw size={18} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
      {/if}
      {#if overlay.type === 'hub-source' && hubSourceHdr.current}
        <button
          type="button"
          class={cn('cal-header-icon-btn', headerIconBtnBase)}
          disabled={hubSourceHdr.current.refreshDisabled}
          title={hubSourceHdr.current.refreshTitle ?? 'Refresh index'}
          aria-label="Refresh index"
          aria-busy={hubSourceHdr.current.refreshSpinning ? 'true' : undefined}
          onclick={() => hubSourceHdr.current?.onRefresh()}
        >
          <span class={hubSourceHdr.current.refreshSpinning ? 'cal-refresh-spin' : ''}>
            <RefreshCw
              size={18}
              strokeWidth={2}
              aria-hidden="true"
              class={hubSourceHdr.current.refreshSpinning ? 'hub-refresh-working' : ''}
            />
          </span>
        </button>
      {/if}
      {#if (overlay.type === 'wiki' || overlay.type === 'wiki-dir') && wikiHdr.current}
        {#if wikiHdr.current.sharedIncoming}
          <span class={cn('wiki-save-hint shrink-0 text-muted', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">Read-only</span>
        {:else if wikiHdr.current.canShare && wikiHdr.current.onOpenShare}
          <button
            type="button"
            class={cn(wikiEditBtn, 'wiki-share-header-btn')}
            onclick={() => wikiHdr.current?.onOpenShare?.()}
            title={wikiSlideShareTitle(wikiHdr.current)}
            aria-label={wikiSlideShareAria(wikiHdr.current)}
          >
            <span class="wiki-share-header-inner relative inline-flex h-full w-full items-center justify-center">
              <Share2 size={15} strokeWidth={2} aria-hidden="true" />
              {#if (wikiHdr.current.shareAudienceCount ?? 0) > 0}
                <span class="wiki-share-header-badge absolute -top-[5px] -right-[9px] box-border inline-block min-w-[16px] rounded-full h-4 bg-accent px-1 text-center text-[10px] font-bold leading-4 text-[var(--bg-pill-on-accent,var(--bg,#fff))] [font-variant-numeric:tabular-nums]" aria-hidden="true">
                  {wikiShareAudienceBadge(wikiHdr.current.shareAudienceCount)}
                </span>
              {/if}
            </span>
          </button>
        {/if}
      {/if}
      {#if overlay.type === 'wiki' && wikiHdr.current}
        {#if wikiHdr.current.saveState === 'saving'}
          <span class={cn('wiki-save-hint shrink-0 text-muted', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">Saving…</span>
        {:else if wikiHdr.current.saveState === 'saved'}
          <span class={cn('wiki-save-hint shrink-0 text-muted', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">Saved</span>
        {:else if wikiHdr.current.saveState === 'error'}
          <span class={cn('wiki-save-hint wiki-save-err shrink-0 text-[var(--danger,#c44)]', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">Save failed</span>
        {/if}
        <button
          type="button"
          class={cn(
            wikiEditBtn,
            wikiHdr.current.pageMode === 'edit' && 'active text-accent',
          )}
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
        <div class="inbox-thread-header-actions flex shrink-0 items-center gap-0.5" role="toolbar" aria-label="Thread actions">
          <button
            type="button"
            class={inboxThreadHeaderBtn}
            onclick={() => inboxHdr.current?.onReply()}
            title="Reply"
            aria-label="Reply"
          >
            <Reply size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            class={inboxThreadHeaderBtn}
            onclick={() => inboxHdr.current?.onForward()}
            title="Forward"
            aria-label="Forward"
          >
            <Forward size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            class={inboxThreadHeaderBtn}
            onclick={() => inboxHdr.current?.onArchive()}
            title="Archive"
            aria-label="Archive thread"
          >
            <Archive size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      {/if}
      {#if overlay.type === 'email-draft' && emailDraftHdr.current}
        <div class="inbox-thread-header-actions flex shrink-0 items-center gap-0.5" role="toolbar" aria-label="Draft actions">
          {#if emailDraftHdr.current.saveState === 'saving'}
            <span class={cn('wiki-save-hint shrink-0 text-muted', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">Saving…</span>
          {:else if emailDraftHdr.current.saveState === 'saved'}
            <span class={cn('wiki-save-hint shrink-0 text-muted', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">Saved</span>
          {:else if emailDraftHdr.current.saveState === 'error'}
            <span class={cn('wiki-save-hint wiki-save-err shrink-0 text-[var(--danger,#c44)]', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">Save failed</span>
          {/if}
          <button
            type="button"
            class={inboxThreadHeaderBtn}
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
            class={inboxThreadHeaderBtn}
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
          class="fullscreen-btn-desktop hidden md:inline-flex h-8 w-8 shrink-0 items-center justify-center border-none bg-transparent text-muted outline-none transition-colors focus-visible:bg-surface-3 focus-visible:text-foreground hover:enabled:bg-surface-3 hover:enabled:text-foreground"
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
        class="close-btn-desktop hidden md:inline-flex h-8 w-8 shrink-0 items-center justify-center border-none bg-transparent text-muted transition-colors hover:text-foreground"
        onclick={headerDismiss}
        aria-label={overlay.type === 'email-draft' && emailDraftHdr.current ? 'Discard draft' : 'Close panel'}
        title={overlay.type === 'email-draft' && emailDraftHdr.current ? 'Discard draft' : 'Close'}
      >
        <X size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    {/snippet}
  </PaneL2Header>
  <div
    class="slide-body flex min-h-0 flex-1 flex-col overflow-hidden"
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
        shareOwner={overlay.shareOwner}
        sharePrefix={overlay.sharePrefix}
        shareHandle={overlay.shareHandle}
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
        shareOwner={overlay.shareOwner}
        sharePrefix={overlay.sharePrefix}
        shareHandle={overlay.shareHandle}
        refreshKey={wikiRefreshKey}
        onOpenFile={(path) => onWikiNavigate(path)}
        onOpenDir={(path) => onWikiDirNavigate?.(path)}
        onOpenSharedDir={onOpenSharedWiki}
        onOpenSharedFile={onOpenSharedWikiFile}
        onContextChange={onContextChange}
      />
    {:else if overlay.type === 'file'}
      <FileViewer initialPath={overlay.path} onContextChange={onContextChange} />
    {:else if overlay.type === 'indexed-file' && overlay.id}
      <IndexedFileViewer id={overlay.id} source={overlay.source} onContextChange={onContextChange} />
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
        searchSource={mailSearchResults?.searchSource}
        onOpenEmail={toolOnOpenEmail}
        onOpenIndexedFile={toolOnOpenIndexedFile}
      />
    {:else if overlay.type === 'messages'}
      <MessageThread initialChat={overlay.chat} onContextChange={onContextChange} />
    {:else if overlay.type === 'your-wiki'}
      <YourWikiDetail
        onOpenWiki={(path) => {
          if (path) onWikiNavigate(path)
        }}
        onOpenFile={toolOnOpenFile}
        onOpenIndexedFile={toolOnOpenIndexedFile}
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
  /* Mobile slide animation: not expressible with Tailwind utilities (state-driven transitions). */
  .slide-over.mobile-slide.slide-anim:not(.dragging) {
    transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
  }

  /* Refresh-spin keyframes (reused for inline refresh icons in the header). */
  .cal-refresh-spin :global(svg) {
    animation: cal-refresh-spin 0.8s linear infinite;
  }

  @keyframes cal-refresh-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Per-pane height fill for the body content (deep `:global` selectors). */
  .slide-body :global(.wiki),
  .slide-body :global(.inbox),
  .slide-body :global(.calendar),
  .slide-body :global(.mail-search-panel),
  .slide-body :global(.hub-bg-agents-detail),
  .slide-body :global(.hub-connector-source) {
    flex: 1;
    min-height: 0;
  }

  /* Wiki page-name row inherits header sizing in mobile L2 bar. */
  .slide-over.mobile-slide :global(.wfn-title-row) {
    font-size: 15px;
  }
</style>
