<script lang="ts">
  import {
    Archive,
    BookOpen,
    FileText,
    FolderOpen,
    Image as ImageIcon,
    Calendar as CalendarIcon,
    ChevronLeft,
    Forward,
    Link2,
    Loader2,
    Mail,
    Maximize2,
    MessageSquare,
    Minimize2,
    Pause,
    EllipsisVertical,
    Play,
    RefreshCw,
    Reply,
    Save,
    Search,
    Send,
    X,
  } from '@lucide/svelte'
  import Wiki from '@components/Wiki.svelte'
  import WikiDirList from '@components/WikiDirList.svelte'
  import FileViewer from '@components/FileViewer.svelte'
  import IndexedFileViewer from '@components/IndexedFileViewer.svelte'
  import Inbox from '@components/Inbox.svelte'
  import Calendar from '@components/Calendar.svelte'
  import MessageThread from '@components/MessageThread.svelte'
  import MailSearchResultsPanel from '@components/MailSearchResultsPanel.svelte'
  import VisualArtifactImageViewer from '@components/VisualArtifactImageViewer.svelte'
  import YourWikiDetail from '@components/YourWikiDetail.svelte'
  import HubConnectorSourcePanel from '@components/hub-connector/HubConnectorSourcePanel.svelte'
  import HubWikiAboutPanel from '@components/HubWikiAboutPanel.svelte'
  import WikiFileName from '@components/WikiFileName.svelte'
  import EmailDraftEditor from '@components/EmailDraftEditor.svelte'
  import PaneL2Header from '@components/PaneL2Header.svelte'
  import CollapsibleBreadcrumb from '@components/CollapsibleBreadcrumb.svelte'
  import AnchoredActionMenu from './AnchoredActionMenu.svelte'
  import AnchoredMenuRow from './AnchoredMenuRow.svelte'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'
  import type { Overlay, SurfaceContext } from '@client/lib/router.js'
  import type { MailSearchResultsState } from '@client/lib/assistantShellModel.js'
  import { createSlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'
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
  import { wikiDirPathPrefix } from '@client/lib/wikiDirBreadcrumb.js'
  import {
    formatWikiPrimaryCrumbLabel,
    wikiPrimaryCrumbsForOverlay,
    wikiPrimaryCrumbMenuIcon,
    type WikiBreadcrumbMenuIcon,
    type WikiOverlayForCrumbs,
  } from '@client/lib/wikiPrimaryBarCrumbs.js'

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
    toolOnOpenVisualArtifact?: (_ref: string, _label?: string) => void
    /** Reserved for future empty-state hooks (previously used by add-folders panel). */
    onOpenWikiAbout?: () => void
    /** Mobile wiki overlay: pop in-doc stack before closing (Assistant shell). */
    onMobileWikiOverlayBack?: () => void
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
    toolOnOpenIndexedFile,
    toolOnOpenEmail,
    toolOnOpenDraft,
    toolOnOpenFullInbox,
    toolOnOpenMessageThread,
    toolOnOpenVisualArtifact,
    onOpenWikiAbout: _onOpenWikiAbout,
    onMobileWikiOverlayBack,
  }: Props = $props()

  let wikiMobileMoreOpen = $state(false)
  let wikiMoreAnchorEl = $state<HTMLButtonElement | null>(null)

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

  function wikiSlideOverBreadcrumbItems(o: WikiOverlayForCrumbs): Array<{
    label: string
    onClick?: () => void
    isCurrent: boolean
    menuIcon?: WikiBreadcrumbMenuIcon
  }> {
    const crumbs = wikiPrimaryCrumbsForOverlay(o)
    return crumbs.map((crumb) => {
      if (crumb.kind === 'wiki-root-link') {
        return {
          label: formatWikiPrimaryCrumbLabel(crumb),
          onClick: () => onWikiDirNavigate?.(undefined),
          isCurrent: false,
          menuIcon: wikiPrimaryCrumbMenuIcon(crumb),
        }
      }
      if (crumb.kind === 'folder-link') {
        return {
          label: formatWikiPrimaryCrumbLabel(crumb),
          onClick: () => onWikiDirNavigate?.(crumb.path),
          isCurrent: false,
          menuIcon: wikiPrimaryCrumbMenuIcon(crumb),
        }
      }
      return {
        label: formatWikiPrimaryCrumbLabel(crumb),
        onClick: undefined,
        isCurrent: true,
      }
    })
  }

  const emailHeaderTitle = $derived(emailThreadTitleForSlideOver(overlay, surfaceContext))
  const emailDraftHeaderTitle = $derived(emailDraftTitleForSlideOver(overlay, surfaceContext))
  const messagesHeaderTitle = $derived(messagesTitleForSlideOver(overlay, surfaceContext))
  const indexedFileHeaderTitle = $derived(indexedFileTitleForSlideOver(overlay, surfaceContext))

  /**
   * Header cells for each overlay type. Children claim a cell during setup, mutate scalar
   * fields via the controller, and clear on destroy. The cells are stable reactive objects
   * — no `register(snapshot)` flush loop, no `updateSeq`, no per-payload equality.
   * See {@link createSlideHeaderCell} and BUG-047.
   */
  const calendarHdr = createSlideHeaderCell<CalendarSlideHeaderState>(CALENDAR_SLIDE_HEADER)
  const wikiHdr = createSlideHeaderCell<WikiSlideHeaderState>(WIKI_SLIDE_HEADER)
  const wikiSlideHeader = $derived(wikiHdr.current)
  const yourWikiHdr = createSlideHeaderCell<YourWikiHeaderState>(YOUR_WIKI_HEADER)
  const inboxHdr = createSlideHeaderCell<InboxThreadHeaderActions>(INBOX_THREAD_HEADER)
  const emailDraftHdr = createSlideHeaderCell<EmailDraftHeaderActions>(EMAIL_DRAFT_HEADER)
  const hubSourceHdr = createSlideHeaderCell<HubSourceSlideHeaderState>(HUB_SOURCE_SLIDE_HEADER)

  /** Back / desktop X: draft uses editor discard (return to thread when applicable). */
  function headerDismiss() {
    if (overlay.type === 'email-draft' && emailDraftHdr.current) {
      emailDraftHdr.current.onDiscard()
      return
    }
    if (mobilePanel && overlay.type === 'wiki' && onMobileWikiOverlayBack) {
      onMobileWikiOverlayBack()
      return
    }
    onBackOrHeaderClose()
  }

  function copyCurrentLocationLink() {
    const href =
      typeof globalThis.location !== 'undefined'
        ? `${globalThis.location.origin}${globalThis.location.pathname}${globalThis.location.search}`
        : ''
    if (!href) return
    void globalThis.navigator?.clipboard?.writeText?.(href)
  }

  function yourWikiPhaseLabel(phase: string | undefined): string {
    if (phase === 'starting') return $t('nav.yourWiki.phase.starting')
    if (phase === 'surveying') return $t('nav.yourWiki.phase.surveying')
    if (phase === 'enriching') return $t('nav.yourWiki.phase.enriching')
    if (phase === 'cleaning') return $t('nav.yourWiki.phase.cleaning')
    if (phase === 'paused') return $t('nav.yourWiki.phase.paused')
    if (phase === 'error') return $t('nav.yourWiki.phase.error')
    return $t('nav.yourWiki.phase.idle')
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
    mobilePanel &&
      'mobile-slide [will-change:transform] [touch-action:pan-y] [overscroll-behavior-x:contain] [--pane-header-h:52px] [--pane-header-px:4px] [&_.pane-l2-header]:[column-gap:0.25rem]',
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
          'back-btn inline-flex shrink-0 items-center gap-1 px-0 py-1 text-[13px] text-accent md:hidden',
          'hover:bg-accent-dim',
          mobilePanel &&
            'min-h-11 min-w-11 justify-center py-0 text-[15px] [&_svg]:h-[22px] [&_svg]:w-[22px]',
        )}
        onclick={headerDismiss}
        aria-label={overlay.type === 'email-draft' && emailDraftHdr.current ? $t('common.actions.discardDraft') : $t('common.actions.back')}
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
        <div class="cal-week-inline flex flex-1 min-w-0 items-center justify-center gap-2" aria-label={$t('nav.calendar.weekNavigation')}>
          <button
            type="button"
            class={cn(
              'cal-nav-btn flex h-7 w-7 max-md:h-10 max-md:w-10 max-md:text-lg shrink-0 items-center justify-center text-base text-muted hover:bg-surface-3 hover:text-foreground',
            )}
            onclick={calendarHdr.current.prevWeek}
            aria-label={$t('nav.calendar.previousWeek')}
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
            aria-label={$t('nav.calendar.nextWeek')}
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
              (overlay.type === 'messages' && messagesHeaderTitle) ||
              overlay.type === 'visual-artifact')
              && 'slide-title-wiki normal-case font-normal tracking-normal',
            mobilePanel && 'text-sm',
          )}
        >
          {#if overlay.type === 'wiki' && overlay.path}
            {@const breadcrumbItems = wikiSlideOverBreadcrumbItems({
              type: 'wiki',
              path: overlay.path,
            })}
            <CollapsibleBreadcrumb items={breadcrumbItems} {mobilePanel} />
          {:else if overlay.type === 'wiki-dir'}
            {@const breadcrumbItems = wikiSlideOverBreadcrumbItems({
              type: 'wiki-dir',
              path: overlay.path,
            })}
            <CollapsibleBreadcrumb items={breadcrumbItems} {mobilePanel} />
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
          {:else if overlay.type === 'visual-artifact'}
            <span class="slide-title-email flex flex-1 min-w-0 items-center gap-2 overflow-hidden">
              <ImageIcon size={mobilePanel ? 20 : 14} strokeWidth={2} aria-hidden="true" class="shrink-0 text-muted" />
              <span class={cn('slide-title-email-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground', mobilePanel ? 'text-[15px]' : 'text-[13px]')}>{overlay.label?.trim() || $t('cards.visualArtifactImageViewer.defaultTitle')}</span>
            </span>
          {:else if overlay.type === 'your-wiki' && yourWikiHdr.current?.doc}
            <div class="your-wiki-header-center flex flex-1 min-w-0 items-center gap-3">
              <span class="slide-title">{titleForOverlay(overlay)}</span>
              <div class="your-wiki-status-inline flex shrink-0 items-center gap-2">
                <span class={cn(
                  'phase-pill-mini whitespace-nowrap bg-surface-3 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider text-muted',
                  mobilePanel && 'text-[10px] px-1.5 py-0.5',
                  ['starting', 'surveying', 'enriching', 'cleaning'].includes(yourWikiHdr.current.doc.phase) && 'bg-accent text-accent-foreground',
                )}>
                  {yourWikiPhaseLabel(yourWikiHdr.current.doc.phase)}
                </span>
                {#if yourWikiHdr.current.doc.pageCount > 0}
                  <span class={cn('page-count-mini whitespace-nowrap text-muted [font-variant-numeric:tabular-nums]', mobilePanel ? 'text-xs' : 'text-[11px]')}>{$t('nav.yourWiki.pageCount', { count: yourWikiHdr.current.doc.pageCount })}</span>
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
              title={$t('nav.yourWiki.pauseLoop')}
            >
              <Pause size={14} aria-hidden="true" />
            </button>
          {:else if yourWikiHdr.current.doc?.phase === 'paused' || yourWikiHdr.current.doc?.phase === 'error'}
            <button
              type="button"
              class={cn('header-action-btn header-action-btn-primary flex h-7 w-7 max-md:h-10 max-md:w-10 items-center justify-center text-accent transition-colors hover:enabled:bg-accent-dim hover:enabled:text-accent [&_svg]:max-md:h-5 [&_svg]:max-md:w-5')}
              disabled={yourWikiHdr.current.actionBusy}
              onclick={yourWikiHdr.current.resume}
              title={$t('nav.yourWiki.resumeLoop')}
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
          title={$t('common.actions.today')}
          aria-label={$t('common.actions.today')}
        >
          <CalendarIcon size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          class={cn('cal-header-icon-btn', headerIconBtnBase)}
          onclick={calendarHdr.current.refreshCalendars}
          disabled={calendarHdr.current.headerBusy}
          title={$t('nav.calendar.refreshCalendars')}
          aria-label={$t('nav.calendar.refreshCalendars')}
        >
          <span class={calendarHdr.current.headerBusy ? 'cal-refresh-spin' : ''}>
            <RefreshCw size={18} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
      {/if}
      {#if overlay.type === 'hub-source' && hubSourceHdr.current}
        {@const hubSrcHdr = hubSourceHdr.current}
        {@const hubRefreshLabel =
          hubSrcHdr.refreshDisabled && hubSrcHdr.refreshTitle
            ? hubSrcHdr.refreshTitle
            : (hubSrcHdr.refreshAriaLabel ??
              hubSrcHdr.refreshTitle ??
              $t('nav.hub.refreshIndex'))}
        <button
          type="button"
          class={cn('cal-header-icon-btn', headerIconBtnBase)}
          disabled={hubSrcHdr.refreshDisabled}
          title={hubRefreshLabel}
          aria-label={hubRefreshLabel}
          aria-busy={hubSrcHdr.refreshSpinning ? 'true' : undefined}
          onclick={() => hubSourceHdr.current?.onRefresh()}
        >
          <span class={hubSrcHdr.refreshSpinning ? 'cal-refresh-spin' : ''}>
            <RefreshCw
              size={18}
              strokeWidth={2}
              aria-hidden="true"
              class={hubSrcHdr.refreshSpinning ? 'hub-refresh-working' : ''}
            />
          </span>
        </button>
      {/if}
      {#if overlay.type === 'wiki' && wikiSlideHeader}
        {#if wikiSlideHeader.saveState === 'saving'}
          <span class={cn('wiki-save-hint shrink-0 text-muted', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">{$t('common.status.saving')}</span>
        {:else if wikiSlideHeader.saveState === 'saved'}
          <span class={cn('wiki-save-hint shrink-0 text-muted', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">{$t('common.status.saved')}</span>
        {:else if wikiSlideHeader.saveState === 'error'}
          <span class={cn('wiki-save-hint wiki-save-err shrink-0 text-[var(--danger,#c44)]', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">{$t('common.status.saveFailed')}</span>
        {/if}
      {/if}
      {#if mobilePanel && (overlay.type === 'wiki' || overlay.type === 'wiki-dir')}
        <button
          bind:this={wikiMoreAnchorEl}
          type="button"
          class={cn(wikiEditBtn, 'wiki-more-sheet-btn')}
          onclick={() => {
            wikiMobileMoreOpen = !wikiMobileMoreOpen
          }}
          title={$t('nav.menu.moreActions')}
          aria-label={$t('nav.menu.moreWikiActions')}
          aria-expanded={wikiMobileMoreOpen}
          aria-haspopup="menu"
        >
          <EllipsisVertical size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      {/if}
      {#if overlay.type === 'email' && inboxHdr.current}
        <div class="inbox-thread-header-actions flex shrink-0 items-center gap-0.5" role="toolbar" aria-label={$t('nav.thread.actions')}>
          <button
            type="button"
            class={inboxThreadHeaderBtn}
            onclick={() => inboxHdr.current?.onReply()}
            title={$t('common.actions.reply')}
            aria-label={$t('common.actions.reply')}
          >
            <Reply size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            class={inboxThreadHeaderBtn}
            onclick={() => inboxHdr.current?.onForward()}
            title={$t('common.actions.forward')}
            aria-label={$t('common.actions.forward')}
          >
            <Forward size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            class={inboxThreadHeaderBtn}
            onclick={() => inboxHdr.current?.onArchive()}
            title={$t('common.actions.archive')}
            aria-label={$t('common.actions.archiveThread')}
          >
            <Archive size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      {/if}
      {#if overlay.type === 'email-draft' && emailDraftHdr.current}
        <div class="inbox-thread-header-actions flex shrink-0 items-center gap-0.5" role="toolbar" aria-label={$t('nav.draft.actions')}>
          {#if emailDraftHdr.current.saveState === 'saving'}
            <span class={cn('wiki-save-hint shrink-0 text-muted', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">{$t('common.status.saving')}</span>
          {:else if emailDraftHdr.current.saveState === 'saved'}
            <span class={cn('wiki-save-hint shrink-0 text-muted', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">{$t('common.status.saved')}</span>
          {:else if emailDraftHdr.current.saveState === 'error'}
            <span class={cn('wiki-save-hint wiki-save-err shrink-0 text-[var(--danger,#c44)]', mobilePanel ? 'text-[13px]' : 'text-xs')} role="status">{$t('common.status.saveFailed')}</span>
          {/if}
          <button
            type="button"
            class={inboxThreadHeaderBtn}
            onclick={() => void emailDraftHdr.current?.onSave()}
            disabled={
              emailDraftHdr.current.sendState === 'sending' ||
              emailDraftHdr.current.saveState === 'saving'
            }
            title={$t('common.actions.saveDraft')}
            aria-label={$t('common.actions.saveDraft')}
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
            title={$t('common.actions.send')}
            aria-label={$t('common.actions.send')}
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
          title={detailFullscreen ? $t('common.actions.exitFullscreen') : $t('common.actions.fullscreen')}
          aria-label={detailFullscreen ? $t('common.actions.exitFullscreen') : $t('common.actions.fullscreen')}
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
        aria-label={overlay.type === 'email-draft' && emailDraftHdr.current ? $t('common.actions.discardDraft') : $t('common.actions.closePanel')}
        title={overlay.type === 'email-draft' && emailDraftHdr.current ? $t('common.actions.discardDraft') : $t('common.actions.close')}
      >
        <X size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    {/snippet}
  </PaneL2Header>
  {#if mobilePanel && (overlay.type === 'wiki' || overlay.type === 'wiki-dir')}
    <AnchoredActionMenu
      open={wikiMobileMoreOpen}
      anchorEl={wikiMoreAnchorEl}
      menuLabel={overlay.type === 'wiki' ? $t('nav.menu.pageActions') : $t('nav.menu.folderActions')}
      onDismiss={() => {
        wikiMobileMoreOpen = false
      }}
    >
      {#snippet children()}
        {#if overlay.type === 'wiki' && overlay.path}
          {@const pSegs = wikiPageBreadcrumbSegments(overlay.path)}
          {#if pSegs.length >= 2}
            <AnchoredMenuRow
              label={$t('nav.slideOver.openFolder')}
              onclick={() => {
                onWikiDirNavigate?.(wikiDirPathPrefix(pSegs, pSegs.length - 2))
                wikiMobileMoreOpen = false
              }}
            >
              {#snippet leading()}
                <FolderOpen size={18} strokeWidth={2} aria-hidden="true" />
              {/snippet}
            </AnchoredMenuRow>
          {:else}
            <AnchoredMenuRow
              label={$t('nav.slideOver.openWikiHome')}
              onclick={() => {
                onWikiDirNavigate?.(undefined)
                wikiMobileMoreOpen = false
              }}
            >
              {#snippet leading()}
                <BookOpen size={18} strokeWidth={2} aria-hidden="true" />
              {/snippet}
            </AnchoredMenuRow>
          {/if}
        {:else if overlay.type === 'wiki-dir'}
          <AnchoredMenuRow
            label={$t('common.actions.search')}
            onclick={() => {
              onOpenSearch?.()
              wikiMobileMoreOpen = false
            }}
          >
            {#snippet leading()}
              <Search size={18} strokeWidth={2} aria-hidden="true" />
            {/snippet}
          </AnchoredMenuRow>
        {/if}
        <AnchoredMenuRow
          label={$t('common.actions.copyLink')}
          onclick={() => {
            copyCurrentLocationLink()
            wikiMobileMoreOpen = false
          }}
        >
          {#snippet leading()}
            <Link2 size={18} strokeWidth={2} aria-hidden="true" />
          {/snippet}
        </AnchoredMenuRow>
      {/snippet}
    </AnchoredActionMenu>
  {/if}
  <div
    class="slide-body flex min-h-0 flex-1 flex-col overflow-hidden"
    bind:this={mobile.slideBodyEl}
    role={mobilePanel ? 'region' : undefined}
    aria-label={mobilePanel ? $t('nav.slideOver.detailContent') : undefined}
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
        onCalendarNavigate={onCalendarNavigate}
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
        queryLine={mailSearchResults?.queryLine ?? overlay.query ?? $t('nav.search.mailFallback')}
        items={mailSearchResults?.items ?? null}
        totalMatched={mailSearchResults?.totalMatched}
        searchSource={mailSearchResults?.searchSource}
        onOpenEmail={toolOnOpenEmail}
        onOpenIndexedFile={toolOnOpenIndexedFile}
      />
    {:else if overlay.type === 'messages'}
      <MessageThread initialChat={overlay.chat} onContextChange={onContextChange} />
    {:else if overlay.type === 'visual-artifact' && overlay.ref}
      <VisualArtifactImageViewer ref={overlay.ref} label={overlay.label} />
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
        onOpenVisualArtifact={toolOnOpenVisualArtifact}
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
  .slide-body :global(.visual-artifact-viewer),
  .slide-body :global(.hub-connector-source) {
    flex: 1;
    min-height: 0;
  }

  /* Wiki page-name row inherits header sizing in mobile L2 bar. */
  .slide-over.mobile-slide :global(.wfn-title-row) {
    font-size: 15px;
  }
</style>
