<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fly, slide } from 'svelte/transition'
  import Search from './Search.svelte'
  import AppTopNav from './AppTopNav.svelte'
  import BrainHubPage from './BrainHubPage.svelte'
  import BrainSettingsPage from './BrainSettingsPage.svelte'
  import Wiki from './Wiki.svelte'
  import WikiDirList from './WikiDirList.svelte'
  import UnifiedChatComposer from './UnifiedChatComposer.svelte'
  import AssistantSlideOver from './AssistantSlideOver.svelte'
  import AgentChat from './AgentChat.svelte'
  import ChatHistory from './ChatHistory.svelte'
  import ChatHistoryPage from './ChatHistoryPage.svelte'
  import WorkspaceSplit from './WorkspaceSplit.svelte'
  import {
    parseRoute,
    readTailFromCache,
    rememberChatTail,
    routeToUrl,
    type Route,
    type SurfaceContext,
    type Overlay,
    type NavigateOptions,
  } from '@client/router.js'
  import {
    CHAT_HISTORY_PAGE_LIST_LIMIT,
    CHAT_HISTORY_SIDEBAR_FETCH_LIMIT,
    fetchChatSessionListDeduped,
  } from '@client/lib/chatHistorySessions.js'
  import { matchSessionIdByFlatPrefix } from '@client/lib/chatSessionTailResolve.js'
  import { applyHubDetailNavigation, applySettingsDetailNavigation } from '@client/lib/hubShellNavigate.js'
  import { overlaySupportsMobileChatBridge } from '@client/lib/mobileDetailChatOverlay.js'
  import { runParallelSyncs } from '@client/lib/app/syncAllServices.js'
  import { matchGlobalShortcut } from '@client/lib/app/globalShortcuts.js'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { startHubEventsConnection } from '@client/lib/hubEvents/hubEventsClient.js'
  import {
    cancelPendingDebouncedWikiSync,
    onWikiMutatedForAutoSync,
    registerDebouncedWikiSyncRunner,
    runSyncOrQueueFollowUp,
  } from '@client/lib/app/debouncedWikiSync.js'
  import { wikiPathForReadToolArg } from '@client/lib/cards/contentCards.js'
  import {
    wikiPrimaryCrumbsForDir,
    wikiPrimaryCrumbsForFile,
    type WikiPrimaryCrumb,
  } from '@client/lib/wikiPrimaryBarCrumbs.js'
  import { navigateFromAgentOpen, type AgentOpenSource } from '@client/lib/navigateFromAgentOpen.js'
  import { WORKSPACE_DESKTOP_SPLIT_MIN_PX } from '@client/lib/app/workspaceLayout.js'
  import { fetchVaultStatus } from '@client/lib/vaultClient.js'
  import { addToNavHistory, makeNavHistoryId, upsertEmailNavHistory } from '@client/lib/navHistory.js'
  import type { MailSearchResultsState } from '@client/lib/assistantShellModel.js'
  import {
    chatSessionPatch,
    closeOverlayStrategy,
    formatLocalDateYmd,
    hubActiveForOpenOverlay as hubActiveForOpenOverlayFromRoute,
    isStaleAgentSessionVersusChatBar,
    shouldDisableTopNavNewChat,
    shouldReplaceWikiOverlay,
  } from '@client/lib/assistantShellNavigation.js'
  import { waitUntilDefinedOrMaxTicks } from '@client/lib/async/waitUntilReady.js'
  import { alignShellWithBareChatRoute, createAssistantShellState, createShellNavigate } from '@client/lib/assistant/shell.js'
  import { contextPlaceholder, type SkillMenuItem } from '@client/lib/agentUtils.js'
  import { applyVoiceTranscriptToChat } from '@client/lib/voiceTranscribeRouting.js'
  import { readHearRepliesPreference } from '@client/lib/hearRepliesPreference.js'
  import { isPressToTalkEnabled } from '@client/lib/pressToTalkEnabled.js'
  import { registerWikiFileListRefetch } from '@client/lib/wikiFileListRefetch.js'
  import { wikiPrimaryChatMessageOrNull } from '@client/lib/wikiPrimaryChatSend.js'
  import { emptyAssistantRefs } from './assistantShellRefs.js'

  /** Route bar, sync, overlays, and layout — one factory instead of a wall of `let` declarations. */
  let shell = $state(createAssistantShellState())
  /** `bind:this` targets for AgentChat / WorkspaceSplit / slide stack / history list. */
  let refs = $state(emptyAssistantRefs())

  const { navigateShell, optsWithBarTitle } = createShellNavigate(() => shell.chatTitleForUrl)

  /** Invalidates in-flight `loadSession` when the bar’s `/c/:id` changes again (back/forward). */
  let urlSessionSyncGen = 0

  /**
   * Desktop side-by-side chat + detail (vs slide-over). Uses measured workspace width so an open
   * history rail does not force two narrow columns on a wide window.
   */
  const useDesktopSplitDetail = $derived(
    !shell.isMobile && shell.workspaceColumnWidth >= WORKSPACE_DESKTOP_SPLIT_MIN_PX,
  )
  const slideOverCloseAnimated = $derived(!useDesktopSplitDetail && refs.mobileSlideOver)

  const effectiveChatSessionId = $derived(shell.route.sessionId ?? shell.resolvedTailSessionId ?? null)

  const sessionHighlightId = $derived<string | null>(effectiveChatSessionId ?? shell.activeSessionId)

  const activeMailSearchResults = $derived.by((): MailSearchResultsState | null => {
    const overlay = shell.route.overlay
    if (overlay?.type !== 'mail-search' || !overlay.id) return null
    return shell.mailSearchResults[overlay.id] ?? null
  })

  /** Disable New chat only on bare `/c` (no slug, no `?panel=`), not merely when the transcript is empty. */
  const topNavNewChatDisabled = $derived(shouldDisableTopNavNewChat(shell.route, effectiveChatSessionId))

  /** Primary wiki pane header: Wiki / folders / page (see `wiki-primary-bar`). */
  const wikiPrimaryBarCrumbs = $derived.by((): WikiPrimaryCrumb[] => {
    if (!shell.route.wikiActive) return []
    const o = shell.route.overlay
    if (!o || (o.type !== 'wiki' && o.type !== 'wiki-dir')) return []
    return o.type === 'wiki'
      ? wikiPrimaryCrumbsForFile(o.path?.trim() ?? '')
      : wikiPrimaryCrumbsForDir(o.path)
  })

  let wikiDockWikiFiles = $state<string[]>([])
  let wikiDockSkills = $state<SkillMenuItem[]>([])
  let wikiDockDraft = $state('')
  let wikiDockHearReplies = $state(readHearRepliesPreference())
  let wikiDockComposerRef = $state<ReturnType<typeof UnifiedChatComposer> | undefined>(undefined)

  const wikiDockPlaceholder = $derived(contextPlaceholder(shell.agentContext))
  const wikiDockComposerSessionKey = $derived.by(() => {
    const o = shell.route.overlay
    if (!o || (o.type !== 'wiki' && o.type !== 'wiki-dir')) return 'wiki-primary'
    const p = 'path' in o ? (o.path ?? '') : ''
    return `wiki-primary-${o.type}-${p}`
  })
  const wikiDockVoiceEligible = $derived(isPressToTalkEnabled())

  function chatSessionPart(): Pick<Route, 'sessionId' | 'sessionTail'> {
    return chatSessionPatch(shell.route, effectiveChatSessionId)
  }

  $effect(() => {
    const tail = shell.route.sessionTail
    const sid = shell.route.sessionId
    if (sid) {
      shell.resolvedTailSessionId = null
      return
    }
    if (!tail) {
      shell.resolvedTailSessionId = null
      return
    }
    const cached = readTailFromCache(tail)
    if (cached) {
      shell.resolvedTailSessionId = cached
      return
    }
    let cancelled = false
    void (async () => {
      const idsShort =
        (await fetchChatSessionListDeduped(fetch, CHAT_HISTORY_SIDEBAR_FETCH_LIMIT))?.map((s) => s.sessionId) ??
        []
      let hit = matchSessionIdByFlatPrefix(tail, idsShort)
      if (!hit) {
        const idsFull =
          (await fetchChatSessionListDeduped(fetch, CHAT_HISTORY_PAGE_LIST_LIMIT))?.map((s) => s.sessionId) ??
          []
        hit = matchSessionIdByFlatPrefix(tail, idsFull)
      }
      if (cancelled || !hit) return
      rememberChatTail(tail, hit)
      shell.resolvedTailSessionId = hit
    })()
    return () => {
      cancelled = true
    }
  })

  const SIDEBAR_TRANSITION_MS = 220

  /**
   * Mobile: drawer over content (transform slide).
   * Desktop: width animation so flex reflows with the rail as it opens/closes.
   */
  function historySidebarTransition(
    node: Element,
    { mobile, reduce }: { mobile: boolean; reduce: boolean }
  ) {
    if (mobile) {
      const el = node as HTMLElement
      const w =
        el.offsetWidth ||
        Math.round((typeof window !== 'undefined' ? window.innerWidth : 400) * 0.9)
      return fly(node, {
        x: reduce ? 0 : -w,
        duration: reduce ? 0 : SIDEBAR_TRANSITION_MS,
      })
    }
    return slide(node, {
      axis: 'x',
      duration: reduce ? 0 : SIDEBAR_TRANSITION_MS,
    })
  }

  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const syncMobile = () => { shell.isMobile = mq.matches }
    syncMobile()

    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncReduce = () => { shell.reduceSidebarMotion = mqReduce.matches }
    syncReduce()
    mqReduce.addEventListener('change', syncReduce)

    void fetchVaultStatus()
      .then((v) => {
        if (
          v.multiTenant === true &&
          v.handleConfirmed === true &&
          typeof v.workspaceHandle === 'string' &&
          v.workspaceHandle.length > 0
        ) {
          shell.hostedHandleNav = v.workspaceHandle
        } else {
          shell.hostedHandleNav = undefined
        }
      })
      .catch(() => {
        shell.hostedHandleNav = undefined
      })

    if (mq.matches) {
      shell.sidebarOpen = false
    } else {
      shell.sidebarOpen = true
    }

    shell.route = parseRoute()

    const onPopState = () => {
      shell.route = parseRoute()
    }
    window.addEventListener('popstate', onPopState)
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && shell.route.wikiActive) {
        e.preventDefault()
        closeWikiPrimary()
        return
      }
      if (e.key === 'Escape' && shell.route.overlay) {
        e.preventDefault()
        if (slideOverCloseAnimated) slideOverCloseAnimated.closeAnimated()
        else closeOverlay()
        return
      }
      if (e.key === 'Escape' && shell.sidebarOpen) {
        e.preventDefault()
        shell.sidebarOpen = false
        return
      }
      const action = matchGlobalShortcut(e)
      if (!action) return
      e.preventDefault()
      switch (action.type) {
        case 'search':
          shell.showSearch = true
          break
        case 'newChat':
          historyNewChat()
          break
        case 'refresh':
          void syncAll()
          break
        case 'wikiHome':
          navigateWikiPrimary()
          break
      }
    }
    window.addEventListener('keydown', onKeydown, true)

    void (async () => {
      let wantKickoff = false
      try {
        const res = await fetch('/api/chat/first-chat-pending')
        if (res.ok) {
          const j = (await res.json()) as { pending?: boolean }
          wantKickoff = j.pending === true
        }
      } catch {
        return
      }
      if (!wantKickoff) return
      const chat = await waitUntilDefinedOrMaxTicks({
        get: () => refs.agentChat,
        tick,
        maxIterations: 16,
      })
      if (chat) {
        try {
          chat.newChat()
          await tick()
          await chat.sendFirstChatKickoff()
        } catch {
          /* ignore */
        }
      }
    })()

    const onMqChange = () => {
      syncMobile()
    }
    mq.addEventListener('change', onMqChange)

    const stopHubEvents = startHubEventsConnection()

    return () => {
      stopHubEvents()
      mq.removeEventListener('change', onMqChange)
      mqReduce.removeEventListener('change', syncReduce)
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onKeydown, true)
    }
  })

  $effect(() => {
    return subscribe((e) => {
      if (e.type === 'wiki:mutated') {
        shell.wikiRefreshKey++
        onWikiMutatedForAutoSync()
      } else if (e.type === 'sync:completed') {
        shell.calendarRefreshKey++
        shell.wikiRefreshKey++
      }
    })
  })

  function closeWikiPrimary() {
    navigateShell(
      { wikiActive: false, hubActive: false, settingsActive: false, ...chatSessionPart() },
      { replace: true },
    )
    shell.route = parseRoute()
    alignShellWithBareChatRoute(shell)
  }

  function closeOverlayImmediate() {
    if (shell.route.wikiActive) {
      closeWikiPrimary()
      return
    }
    if (shell.route.settingsActive) {
      navigateShell({ settingsActive: true, wikiActive: false, hubActive: false }, { replace: true })
    } else if (shell.route.hubActive) {
      navigateShell({ hubActive: true, wikiActive: false, settingsActive: false }, { replace: true })
    } else {
      navigateShell(
        { hubActive: false, wikiActive: false, settingsActive: false, ...chatSessionPart() },
        { replace: true },
      )
    }
    shell.route = parseRoute()
    alignShellWithBareChatRoute(shell)
  }

  function hubActiveForOpenOverlay(overlay: Overlay): boolean {
    return hubActiveForOpenOverlayFromRoute(shell.route, overlay, shell.isMobile)
  }

  /**
   * Opening a SlideOver while on `/hub` vs `/settings` must keep the matching primary URL;
   * from chat, attach session id and use the chat column.
   */
  function routeSurfaceFlagsForOverlay(overlay: Overlay): {
    hubActive: boolean
    settingsActive: boolean
    useChatSession: boolean
  } {
    const stayOnSurface = hubActiveForOpenOverlay(overlay)
    if (!stayOnSurface) {
      return { hubActive: false, settingsActive: false, useChatSession: true }
    }
    if (shell.route.settingsActive === true) {
      return { hubActive: false, settingsActive: true, useChatSession: false }
    }
    return { hubActive: true, settingsActive: false, useChatSession: false }
  }

  function closeOverlay() {
    const strategy = closeOverlayStrategy(shell.route, useDesktopSplitDetail)
    if (strategy === 'none') return
    if (strategy === 'animated_desktop') {
      refs.workspaceSplit?.closeDesktopAnimated()
      return
    }
    closeOverlayImmediate()
  }

  /**
   * Slide-over layout: dismiss overlay after send so the transcript is visible.
   * Always return to the main chat column (`/c`) so the running agent and transcript are visible
   * (not `/hub` with hub still active).
   */
  function closeOverlayOnUserSend() {
    shell.chatIsEmpty = false
    if (!useDesktopSplitDetail && shell.route.overlay) {
      navigateShell(
        { hubActive: false, wikiActive: false, settingsActive: false, ...chatSessionPart() },
        { replace: true },
      )
      shell.route = parseRoute()
      alignShellWithBareChatRoute(shell)
    }
  }

  function wikiOverlayReplace(): boolean {
    return shouldReplaceWikiOverlay(shell.route)
  }

  function navigateWikiPrimary(path?: string) {
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    const replace = shell.route.wikiActive && shouldReplaceWikiOverlay(shell.route)
    navigateShell({ wikiActive: true, overlay }, replace ? { replace: true } : undefined)
    shell.route = parseRoute()
    if (path) {
      void addToNavHistory({
        id: makeNavHistoryId('doc', path),
        type: 'doc',
        title: path,
        path,
      })
    }
  }

  function openWikiDoc(path?: string) {
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    const replace = wikiOverlayReplace()
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell(
      {
        overlay,
        wikiActive: false,
        hubActive: flags.hubActive,
        settingsActive: flags.settingsActive,
        ...(flags.useChatSession ? chatSessionPart() : {}),
      },
      replace ? { replace: true } : undefined,
    )
    shell.route = parseRoute()
    if (path) {
      void addToNavHistory({
        id: makeNavHistoryId('doc', path),
        type: 'doc',
        title: path,
        path,
      })
    }
  }

  function onWikiNavigate(path: string | undefined) {
    if (shell.route.wikiActive) {
      const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
      const replace = shouldReplaceWikiOverlay(shell.route)
      navigateShell({ wikiActive: true, overlay }, replace ? { replace: true } : undefined)
      shell.route = parseRoute()
      return
    }
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    const replace = wikiOverlayReplace()
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell(
      {
        overlay,
        wikiActive: false,
        hubActive: flags.hubActive,
        settingsActive: flags.settingsActive,
        ...(flags.useChatSession ? chatSessionPart() : {}),
      },
      replace ? { replace: true } : undefined,
    )
    shell.route = parseRoute()
  }

  function openWikiDir(dirPath?: string) {
    if (shell.route.wikiActive) {
      const trimmed = dirPath?.trim()
      const overlay: Overlay = trimmed ? { type: 'wiki-dir', path: trimmed } : { type: 'wiki-dir' }
      const replace = shouldReplaceWikiOverlay(shell.route)
      navigateShell({ wikiActive: true, overlay }, replace ? { replace: true } : undefined)
      shell.route = parseRoute()
      return
    }
    const trimmed = dirPath?.trim()
    const overlay: Overlay = trimmed ? { type: 'wiki-dir', path: trimmed } : { type: 'wiki-dir' }
    const replace = wikiOverlayReplace()
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell(
      {
        overlay,
        wikiActive: false,
        hubActive: flags.hubActive,
        settingsActive: flags.settingsActive,
        ...(flags.useChatSession ? chatSessionPart() : {}),
      },
      replace ? { replace: true } : undefined,
    )
    shell.route = parseRoute()
  }

  function openFileDoc(path: string) {
    const flags = routeSurfaceFlagsForOverlay({ type: 'file', path })
    navigateShell({
      wikiActive: false,
      overlay: { type: 'file', path },
      hubActive: flags.hubActive,
      settingsActive: flags.settingsActive,
      ...(flags.useChatSession ? chatSessionPart() : {}),
    })
    shell.route = parseRoute()
    void addToNavHistory({
      id: makeNavHistoryId('doc', `file:${path}`),
      type: 'doc',
      title: path,
      path,
    })
  }

  function onInboxNavigateSlide(id: string | undefined) {
    const overlay: Overlay = id ? { type: 'email', id } : { type: 'email' }
    const flags = routeSurfaceFlagsForOverlay(overlay)
    const nextRoute: Route = flags.useChatSession
      ? { hubActive: false, settingsActive: false, wikiActive: false, ...chatSessionPart(), overlay }
      : {
          hubActive: flags.hubActive,
          settingsActive: flags.settingsActive,
          wikiActive: false,
          overlay,
        }
    const nextUrl = routeToUrl(nextRoute, optsWithBarTitle())
    if (typeof location !== 'undefined' && nextUrl === `${location.pathname}${location.search}`) {
      return
    }
    navigateShell({
      wikiActive: false,
      overlay,
      hubActive: flags.hubActive,
      settingsActive: flags.settingsActive,
      ...(flags.useChatSession ? chatSessionPart() : {}),
    })
    shell.route = parseRoute()
  }

  function switchToCalendar(date: string, eventId?: string) {
    const overlay: Overlay = { type: 'calendar', date, ...(eventId ? { eventId } : {}) }
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell({
      wikiActive: false,
      overlay,
      hubActive: flags.hubActive,
      settingsActive: flags.settingsActive,
      ...(flags.useChatSession ? chatSessionPart() : {}),
    })
    shell.route = parseRoute()
    shell.agentContext = { type: 'calendar', date, ...(eventId ? { eventId } : {}) }
  }

  function resetCalendarToToday() {
    switchToCalendar(formatLocalDateYmd(new Date()))
  }

  function setContext(ctx: SurfaceContext) {
    shell.agentContext = ctx
    if (ctx.type === 'email' && ctx.threadId) {
      void upsertEmailNavHistory(ctx.threadId, ctx.subject, ctx.from)
    }
  }

  function onSummarizeInbox(message: string) {
    shell.agentContext = { type: 'inbox' }
    void refs.agentChat?.newChatWithMessage(message)
  }

  function openEmailFromSearch(id: string, subject: string, from: string) {
    shell.inboxTargetId = id
    const flags = routeSurfaceFlagsForOverlay({ type: 'email', id })
    navigateShell({
      wikiActive: false,
      overlay: { type: 'email', id },
      hubActive: flags.hubActive,
      settingsActive: flags.settingsActive,
      ...(flags.useChatSession ? chatSessionPart() : {}),
    })
    shell.route = parseRoute()
    shell.agentContext = { type: 'email', threadId: id, subject, from }
    if (id && subject.trim()) {
      void upsertEmailNavHistory(id, subject, from)
    }
  }

  function openEmailFromChat(threadId: string, subject?: string, from?: string) {
    openEmailFromSearch(threadId, subject ?? '', from ?? '')
  }

  function openEmailDraftFromChat(draftId: string, subject?: string) {
    const flags = routeSurfaceFlagsForOverlay({ type: 'email-draft', id: draftId })
    navigateShell({
      wikiActive: false,
      overlay: { type: 'email-draft', id: draftId },
      hubActive: flags.hubActive,
      settingsActive: flags.settingsActive,
      ...(flags.useChatSession ? chatSessionPart() : {}),
    })
    shell.route = parseRoute()
    shell.agentContext = {
      type: 'email-draft',
      draftId,
      subject: subject?.trim() || '(loading)',
      toLine: '',
      bodyPreview: '',
    }
  }

  function openFullInboxFromChat() {
    shell.inboxTargetId = undefined
    navigateShell({
      wikiActive: false,
      hubActive: false,
      settingsActive: false,
      ...chatSessionPart(),
      overlay: { type: 'email' },
    })
    shell.route = parseRoute()
  }

  function openMailSearchResultsFromChat(preview: MailSearchResultsState, sourceId: string) {
    const id = sourceId.trim() || `mail-search-${Date.now()}`
    shell.mailSearchResults = { ...shell.mailSearchResults, [id]: preview }
    const overlay: Overlay = { type: 'mail-search', id, query: preview.queryLine }
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell({
      wikiActive: false,
      overlay,
      hubActive: flags.hubActive,
      settingsActive: flags.settingsActive,
      ...(flags.useChatSession ? chatSessionPart() : {}),
    })
    shell.route = parseRoute()
    shell.agentContext = { type: 'mail-search', query: preview.queryLine }
  }

  function openMessageThreadFromChat(canonicalChat: string, displayLabel: string) {
    const overlay: Overlay = { type: 'messages', chat: canonicalChat }
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell({
      wikiActive: false,
      overlay,
      hubActive: flags.hubActive,
      settingsActive: flags.settingsActive,
      ...(flags.useChatSession ? chatSessionPart() : {}),
    })
    shell.route = parseRoute()
    shell.agentContext = { type: 'messages', chat: canonicalChat, displayLabel }
  }

  /** Brain Hub rows → same detail stack as chat (`SlideOver` + `Overlay`). */
  function navigateFromHub(overlay: Overlay, opts?: NavigateOptions) {
    const hubActive = !shell.isMobile || !overlaySupportsMobileChatBridge(overlay)
    const routeForNav: Route = {
      ...shell.route,
      sessionId: effectiveChatSessionId ?? shell.route.sessionId,
      sessionTail: undefined,
    }
    applyHubDetailNavigation(routeForNav, overlay, optsWithBarTitle(opts), hubActive)
    shell.route = parseRoute()
    if (overlay.type === 'wiki' && overlay.path) {
      void addToNavHistory({
        id: makeNavHistoryId('doc', overlay.path),
        type: 'doc',
        title: overlay.path,
        path: overlay.path,
      })
    }
  }

  /** Settings (data sources) rows → same `SlideOver` stack under `/settings`. */
  function navigateFromSettings(overlay: Overlay, opts?: NavigateOptions) {
    const settingsColumnActive = !shell.isMobile || !overlaySupportsMobileChatBridge(overlay)
    const routeForNav: Route = {
      ...shell.route,
      sessionId: effectiveChatSessionId ?? shell.route.sessionId,
      sessionTail: undefined,
    }
    applySettingsDetailNavigation(routeForNav, overlay, optsWithBarTitle(opts), settingsColumnActive)
    shell.route = parseRoute()
    if (overlay.type === 'wiki' && overlay.path) {
      void addToNavHistory({
        id: makeNavHistoryId('doc', overlay.path),
        type: 'doc',
        title: overlay.path,
        path: overlay.path,
      })
    }
  }

  $effect(() => {
    const o = shell.route.overlay
    if (o?.type === 'messages' && o.chat) {
      if (shell.agentContext.type !== 'messages' || shell.agentContext.chat !== o.chat) {
        shell.agentContext = { type: 'messages', chat: o.chat, displayLabel: '(loading)' }
      }
    }
  })

  /** LLM `open` / `read_email` — navigate on tool_start. Mobile: only `open` opens the panel; `read_email` stays preview-only. */
  function onOpenFromAgent(
    target: { type: string; path?: string; id?: string; date?: string },
    source: AgentOpenSource,
  ) {
    navigateFromAgentOpen(target, {
      source,
      isMobile: !useDesktopSplitDetail,
      openWikiDoc: (path) => openWikiDoc(path),
      openFileDoc: (path) => openFileDoc(path),
      openEmailFromSearch,
      switchToCalendar,
    })
  }

  async function performFullSync(): Promise<void> {
    shell.syncErrors = []
    shell.showSyncErrors = false
    try {
      shell.syncErrors = await runParallelSyncs(fetch)
      emit({ type: 'sync:completed' })
    } finally {
      // done
    }
  }

  async function syncAll() {
    cancelPendingDebouncedWikiSync()
    await runSyncOrQueueFollowUp()
  }

  $effect(() => {
    registerDebouncedWikiSyncRunner(performFullSync)
  })

  function toggleSidebar() {
    shell.sidebarOpen = !shell.sidebarOpen
    if (shell.sidebarOpen) void refs.chatHistory?.refresh()
  }

  async function selectChatSession(id: string, title?: string) {
    shell.chatTitleForUrl = title?.trim() ? title.trim() : null
    navigateShell({ hubActive: false, wikiActive: false, settingsActive: false, sessionId: id }, { replace: true })
    shell.route = parseRoute()
    alignShellWithBareChatRoute(shell)
    const chat = await waitUntilDefinedOrMaxTicks({
      get: () => refs.agentChat,
      tick,
      maxIterations: 16,
    })
    if (chat) await chat.loadSession(id)
    shell.chatIsEmpty = false
    if (shell.isMobile) shell.sidebarOpen = false
  }

  function selectDocFromHistory(path: string) {
    openWikiDoc(path)
    if (shell.isMobile) shell.sidebarOpen = false
  }

  function selectEmailFromHistory(id: string) {
    openEmailFromSearch(id, '', '')
    if (shell.isMobile) shell.sidebarOpen = false
  }

  function historyNewChat() {
    shell.chatTitleForUrl = null
    navigateShell({ hubActive: false, wikiActive: false, settingsActive: false }, { replace: true })
    shell.route = parseRoute()
    alignShellWithBareChatRoute(shell)
    refs.agentChat?.newChat()
    shell.chatIsEmpty = true
    if (shell.isMobile) shell.sidebarOpen = false
  }

  async function fetchWikiDockWikiFiles() {
    try {
      const res = await fetch('/api/wiki')
      if (!res.ok) return
      const data: unknown = await res.json()
      if (!Array.isArray(data)) return
      wikiDockWikiFiles = data
        .map((f) =>
          f && typeof f === 'object' && 'path' in f && typeof (f as { path: unknown }).path === 'string'
            ? (f as { path: string }).path
            : null,
        )
        .filter((p): p is string => p != null)
    } catch {
      /* ignore */
    }
  }

  async function fetchWikiDockSkills() {
    try {
      const res = await fetch('/api/skills')
      if (!res.ok) return
      const data: unknown = await res.json()
      if (!Array.isArray(data)) return
      wikiDockSkills = data as SkillMenuItem[]
    } catch {
      /* ignore */
    }
  }

  function onWikiDockVoiceTranscribe(text: string) {
    applyVoiceTranscriptToChat(
      text,
      wikiDockDraft,
      (t) => void wikiPrimaryComposeSend(t),
      (t) => {
        wikiDockComposerRef?.appendText(t)
      },
    )
  }

  /**
   * Leave wiki-primary, open the main chat column, start a new session, and send the first message
   * (same `newChatWithMessage` path as the main composer).
   * On desktop with a wide workspace, keep the current wiki file or folder open in the right detail
   * stack (`/c?panel=wiki&path=…` or `panel=wiki-dir`) so chat and doc stay side by side.
   */
  async function wikiPrimaryComposeSend(text: string) {
    const t = wikiPrimaryChatMessageOrNull(text)
    if (!t) return
    const o = shell.route.overlay
    const keepDetailForSplit =
      !shell.isMobile &&
      shell.workspaceColumnWidth >= WORKSPACE_DESKTOP_SPLIT_MIN_PX &&
      o &&
      (o.type === 'wiki' || o.type === 'wiki-dir')

    shell.chatTitleForUrl = null
    navigateShell(
      {
        hubActive: false,
        settingsActive: false,
        wikiActive: false,
        ...(keepDetailForSplit ? { overlay: o } : {}),
      },
      { replace: true },
    )
    shell.route = parseRoute()

    if (keepDetailForSplit && o) {
      shell.wikiWriteStreaming = null
      shell.wikiEditStreaming = null
      shell.inboxTargetId = undefined
      if (o.type === 'wiki' && o.path) {
        const title = o.path.replace(/\.md$/i, '').split('/').pop() ?? o.path
        shell.agentContext = { type: 'wiki', path: o.path, title }
      } else if (o.type === 'wiki-dir') {
        const dirPath = o.path?.trim() ?? ''
        const title = dirPath ? (dirPath.split('/').pop() ?? dirPath) : 'Wiki'
        shell.agentContext = { type: 'wiki-dir', path: dirPath, title }
      } else {
        shell.agentContext = { type: 'chat' }
      }
    } else {
      alignShellWithBareChatRoute(shell)
    }

    shell.chatIsEmpty = false
    if (shell.isMobile) shell.sidebarOpen = false
    const chat = await waitUntilDefinedOrMaxTicks({
      get: () => refs.agentChat,
      tick,
      maxIterations: 48,
    })
    if (chat) await chat.newChatWithMessage(t, { skipOverlayClose: true })
  }

  $effect(() => {
    if (!shell.route.wikiActive) return
    void fetchWikiDockWikiFiles()
    void fetchWikiDockSkills()
    return registerWikiFileListRefetch(fetchWikiDockWikiFiles)
  })

  /** Empty-state “your wiki” → same help as Hub (`HubWikiAboutPanel` in SlideOver / mobile stack). */
  function openHubWikiAbout() {
    const onHubLike = shell.route.hubActive === true || shell.route.settingsActive === true
    navigateShell({
      wikiActive: false,
      overlay: { type: 'hub-wiki-about' },
      hubActive: shell.route.hubActive === true,
      settingsActive: shell.route.settingsActive === true,
      ...(onHubLike ? {} : chatSessionPart()),
    })
    shell.route = parseRoute()
  }

  function openChatHistoryPage() {
    const onHubLike = shell.route.hubActive === true || shell.route.settingsActive === true
    navigateShell({
      wikiActive: false,
      overlay: { type: 'chat-history' },
      hubActive: shell.route.hubActive === true,
      settingsActive: shell.route.settingsActive === true,
      ...(onHubLike ? {} : chatSessionPart()),
    })
    shell.route = parseRoute()
  }

  function onSessionChangeFromAgent(id: string | null, meta?: { chatTitle?: string | null }) {
    if (isStaleAgentSessionVersusChatBar(id, effectiveChatSessionId)) {
      shell.activeSessionId = effectiveChatSessionId
      return
    }
    shell.activeSessionId = id
    if (!id) {
      shell.chatTitleForUrl = null
      return
    }
    if (meta?.chatTitle !== undefined) {
      shell.chatTitleForUrl = meta.chatTitle
    }
    if (
      shell.route.flow ||
      shell.route.hubActive === true ||
      shell.route.settingsActive === true ||
      shell.route.wikiActive === true
    )
      return
    const navRoute: Route = {
      hubActive: false,
      settingsActive: false,
      sessionId: id,
      overlay: shell.route.overlay,
    }
    const nextUrl = routeToUrl(navRoute, optsWithBarTitle())
    if (typeof location !== 'undefined' && nextUrl === `${location.pathname}${location.search}`) {
      return
    }
    navigateShell(
      { hubActive: false, settingsActive: false, sessionId: id, overlay: shell.route.overlay },
      { replace: true },
    )
    shell.route = parseRoute()
  }

  $effect(() => {
    const sid = effectiveChatSessionId
    const onChat =
      !shell.route.flow &&
      shell.route.hubActive !== true &&
      shell.route.settingsActive !== true &&
      shell.route.wikiActive !== true &&
      shell.route.overlay?.type !== 'hub'
    if (!onChat || !sid) {
      return
    }
    if (sid === shell.activeSessionId) {
      return
    }
    const gen = ++urlSessionSyncGen
    void (async () => {
      const chat = await waitUntilDefinedOrMaxTicks({
        get: () => refs.agentChat,
        tick,
        maxIterations: 16,
        shouldAbort: () => gen !== urlSessionSyncGen,
      })
      if (gen !== urlSessionSyncGen) return
      if (chat) await chat.loadSession(sid)
    })()
  })

  function onWriteStreaming(p: { path: string; content: string; done: boolean }) {
    if (p.done) {
      shell.wikiWriteStreaming = null
      return
    }
    if (p.path) {
      shell.wikiWriteStreaming = { path: p.path, body: p.content }
    }
  }

  function openSettings() {
    navigateShell({ settingsActive: true, wikiActive: false, hubActive: false })
    shell.route = parseRoute()
    if (shell.isMobile) shell.sidebarOpen = false
  }

  function openHubActivity() {
    navigateShell({ hubActive: true, wikiActive: false, settingsActive: false })
    shell.route = parseRoute()
    if (shell.isMobile) shell.sidebarOpen = false
  }

  function onEditStreaming(p: { id: string; path: string; done: boolean }) {
    if (p.done) {
      if (shell.wikiEditStreaming?.toolId === p.id) shell.wikiEditStreaming = null
      return
    }
    if (p.path) {
      shell.wikiEditStreaming = { path: wikiPathForReadToolArg(p.path), toolId: p.id }
    }
  }

</script>

{#if shell.showSearch}
  <Search
    onOpenWiki={(path) => { openWikiDoc(path); shell.showSearch = false }}
    onWikiHome={navigateWikiPrimary}
    onOpenEmail={(id, subject, from) => { openEmailFromSearch(id, subject, from); shell.showSearch = false }}
    onClose={() => shell.showSearch = false}
  />
{/if}

<div class="app">
    <AppTopNav
    isMobile={shell.isMobile}
    sidebarOpen={shell.sidebarOpen}
    onToggleSidebar={toggleSidebar}
    syncErrors={shell.syncErrors}
    showSyncErrors={shell.showSyncErrors}
    onOpenSearch={() => { shell.showSearch = true }}
    onToggleSyncErrors={() => { shell.showSyncErrors = !shell.showSyncErrors }}
    onOpenHub={() => {
      openHubActivity()
    }}
    onNewChat={historyNewChat}
    onWikiHome={() => navigateWikiPrimary()}
    isEmptyChat={topNavNewChatDisabled}
    hostedHandlePill={shell.hostedHandleNav}
    onOpenSettings={openSettings}
  />

    <div class="app-main-row">
    {#if shell.sidebarOpen}
      {#if shell.isMobile}
        <div
          class="sidebar-backdrop"
          role="presentation"
          aria-hidden="true"
          onclick={() => { shell.sidebarOpen = false }}
        ></div>
      {/if}
      <aside
        class="history-sidebar history-sidebar--slide"
        in:historySidebarTransition={{ mobile: shell.isMobile, reduce: shell.reduceSidebarMotion }}
        out:historySidebarTransition={{ mobile: shell.isMobile, reduce: shell.reduceSidebarMotion }}
      >
        <div class="rail-inner">
          <div class="rail-panel rail-panel--chat">
            <ChatHistory
              bind:this={refs.chatHistory}
              activeSessionId={sessionHighlightId}
              streamingSessionIds={shell.streamingSessionIds}
              onSelect={selectChatSession}
              onSelectDoc={selectDocFromHistory}
              onSelectEmail={selectEmailFromHistory}
              onNewChat={historyNewChat}
              onOpenAllChats={openChatHistoryPage}
              onWikiHome={navigateWikiPrimary}
            />
          </div>
        </div>
      </aside>
    {/if}

    <div class="workspace-column" bind:clientWidth={shell.workspaceColumnWidth}>
  <WorkspaceSplit
    bind:this={refs.workspaceSplit}
    workspaceColumnWidthPx={shell.workspaceColumnWidth}
    bind:detailFullscreen={shell.detailPaneFullscreen}
    hasDetail={
      !shell.route.wikiActive &&
      !!shell.route.overlay &&
      shell.route.overlay.type !== 'hub' &&
      shell.route.overlay.type !== 'chat-history'
    }
    desktopDetailOpen={
      !shell.route.wikiActive &&
      !!shell.route.overlay &&
      shell.route.overlay.type !== 'hub' &&
      shell.route.overlay.type !== 'chat-history' &&
      useDesktopSplitDetail
    }
    onNavigateClear={closeOverlayImmediate}
  >
    {#snippet chat()}
      {#if shell.route.overlay?.type === 'chat-history'}
        <div class="hub-container">
          <div class="hub-scroll">
            <ChatHistoryPage
              activeSessionId={sessionHighlightId}
              streamingSessionIds={shell.streamingSessionIds}
              onSelectSession={selectChatSession}
              onNewChat={historyNewChat}
            />
          </div>
        </div>
      {:else if shell.route.wikiActive && shell.route.overlay && (shell.route.overlay.type === 'wiki' || shell.route.overlay.type === 'wiki-dir')}
        <div class="hub-container">
          <div class="wiki-primary-bar">
            <nav class="wiki-primary-crumbs" aria-label="Wiki location">
              {#each wikiPrimaryBarCrumbs as crumb, i (i)}
                {#if i > 0}<span class="wiki-primary-crumb-sep" aria-hidden="true">/</span>{/if}
                {#if crumb.kind === 'wiki-root-link'}
                  <button
                    type="button"
                    class="wiki-primary-crumb-btn"
                    onclick={() => openWikiDir(undefined)}
                  >Wiki</button>
                {:else if crumb.kind === 'folder-link'}
                  <button
                    type="button"
                    class="wiki-primary-crumb-btn"
                    onclick={() => openWikiDir(crumb.path)}
                  >{crumb.label}</button>
                {:else}
                  <span class="wiki-primary-crumb-current">{crumb.label}</span>
                {/if}
              {/each}
            </nav>
          </div>
          <div class="wiki-primary-main">
            <div class="hub-scroll wiki-primary-scroll">
              {#if shell.route.overlay.type === 'wiki'}
                <Wiki
                  initialPath={shell.route.overlay.path}
                  refreshKey={shell.wikiRefreshKey}
                  streamingWrite={shell.wikiWriteStreaming}
                  streamingEdit={shell.wikiEditStreaming}
                  onNavigate={(path) => onWikiNavigate(path)}
                  onNavigateToDir={openWikiDir}
                  onContextChange={setContext}
                />
              {:else}
                <WikiDirList
                  dirPath={shell.route.overlay.path}
                  refreshKey={shell.wikiRefreshKey}
                  onOpenFile={(path) => onWikiNavigate(path)}
                  onOpenDir={(path) => openWikiDir(path)}
                  onContextChange={setContext}
                />
              {/if}
            </div>
            <div class="wiki-primary-composer-dock">
              <div class="wiki-primary-composer-stack">
                <UnifiedChatComposer
                  bind:this={wikiDockComposerRef}
                  transparentSurround={true}
                  voiceEligible={wikiDockVoiceEligible}
                  sessionResetKey={wikiDockComposerSessionKey}
                  placeholder={wikiDockPlaceholder}
                  streaming={false}
                  queuedMessages={[]}
                  wikiFiles={wikiDockWikiFiles}
                  skills={wikiDockSkills}
                  onSend={(t) => void wikiPrimaryComposeSend(t)}
                  onDraftChange={(d) => {
                    wikiDockDraft = d
                  }}
                  onTranscribe={onWikiDockVoiceTranscribe}
                  onRequestFocusText={() => void wikiDockComposerRef?.focus()}
                  hearReplies={wikiDockHearReplies}
                />
              </div>
            </div>
          </div>
        </div>
      {:else if shell.route.hubActive || shell.route.overlay?.type === 'hub'}
        <div class="hub-container">
          <div class="hub-scroll">
            <BrainHubPage onHubNavigate={navigateFromHub} />
          </div>
          {#if
            !useDesktopSplitDetail &&
            shell.route.overlay &&
            shell.route.overlay.type !== 'hub' &&
            shell.route.overlay.type !== 'chat-history'
          }
            <div class="mobile-detail-layer">
              <AssistantSlideOver
                bind:this={refs.mobileSlideOver}
                variant="mobile"
                overlay={shell.route.overlay}
                surfaceContext={shell.agentContext}
                wikiRefreshKey={shell.wikiRefreshKey}
                calendarRefreshKey={shell.calendarRefreshKey}
                inboxTargetId={shell.inboxTargetId}
                mailSearchResults={activeMailSearchResults}
                wikiStreamingWrite={shell.wikiWriteStreaming}
                wikiStreamingEdit={shell.wikiEditStreaming}
                onWikiNavigate={onWikiNavigate}
                onWikiDirNavigate={openWikiDir}
                onInboxNavigate={onInboxNavigateSlide}
                onContextChange={setContext}
                onOpenSearch={() => { shell.showSearch = true }}
                onSummarizeInbox={onSummarizeInbox}
                onCalendarResetToToday={resetCalendarToToday}
                onCalendarNavigate={switchToCalendar}
                toolOnOpenFile={openFileDoc}
                toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
                toolOnOpenDraft={(id, subj) => openEmailDraftFromChat(id, subj)}
                toolOnOpenFullInbox={openFullInboxFromChat}
                toolOnOpenMessageThread={openMessageThreadFromChat}
                onOpenWikiAbout={openHubWikiAbout}
                onClose={closeOverlay}
              />
            </div>
          {/if}
        </div>
      {:else if shell.route.settingsActive}
        <div class="hub-container">
          <div class="hub-scroll">
            <BrainSettingsPage onSettingsNavigate={navigateFromSettings} />
          </div>
          {#if
            !useDesktopSplitDetail &&
            shell.route.overlay &&
            shell.route.overlay.type !== 'hub' &&
            shell.route.overlay.type !== 'chat-history'
          }
            <div class="mobile-detail-layer">
              <AssistantSlideOver
                bind:this={refs.mobileSlideOver}
                variant="mobile"
                overlay={shell.route.overlay}
                surfaceContext={shell.agentContext}
                wikiRefreshKey={shell.wikiRefreshKey}
                calendarRefreshKey={shell.calendarRefreshKey}
                inboxTargetId={shell.inboxTargetId}
                mailSearchResults={activeMailSearchResults}
                wikiStreamingWrite={shell.wikiWriteStreaming}
                wikiStreamingEdit={shell.wikiEditStreaming}
                onWikiNavigate={onWikiNavigate}
                onWikiDirNavigate={openWikiDir}
                onInboxNavigate={onInboxNavigateSlide}
                onContextChange={setContext}
                onOpenSearch={() => { shell.showSearch = true }}
                onSummarizeInbox={onSummarizeInbox}
                onCalendarResetToToday={resetCalendarToToday}
                onCalendarNavigate={switchToCalendar}
                toolOnOpenFile={openFileDoc}
                toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
                toolOnOpenDraft={(id, subj) => openEmailDraftFromChat(id, subj)}
                toolOnOpenFullInbox={openFullInboxFromChat}
                toolOnOpenMessageThread={openMessageThreadFromChat}
                onOpenWikiAbout={openHubWikiAbout}
                onClose={closeOverlay}
              />
            </div>
          {/if}
        </div>
      {:else}
        <AgentChat
          bind:this={refs.agentChat}
          context={shell.agentContext}
          conversationHidden={!!shell.route.overlay && !useDesktopSplitDetail}
          hideInput={
            shell.isMobile &&
            !useDesktopSplitDetail &&
            !!shell.route.overlay &&
            shell.route.overlay.type !== 'hub' &&
            shell.route.overlay.type !== 'chat-history' &&
            !overlaySupportsMobileChatBridge(shell.route.overlay)
          }
          mobileSlideCoversTranscriptOnly={
            shell.isMobile &&
            !useDesktopSplitDetail &&
            !!shell.route.overlay &&
            shell.route.overlay.type !== 'hub' &&
            shell.route.overlay.type !== 'chat-history' &&
            overlaySupportsMobileChatBridge(shell.route.overlay)
          }
          hidePaneContextChip={!!shell.route.overlay && useDesktopSplitDetail}
          suppressAgentDetailAutoOpen={!useDesktopSplitDetail}
          onOpenWiki={openWikiDoc}
          onOpenFile={openFileDoc}
          onOpenEmail={openEmailFromChat}
          onOpenDraft={openEmailDraftFromChat}
          onOpenFullInbox={openFullInboxFromChat}
          onOpenMessageThread={openMessageThreadFromChat}
          onSwitchToCalendar={switchToCalendar}
          onOpenMailSearchResults={openMailSearchResultsFromChat}
          onOpenFromAgent={onOpenFromAgent}
          onOpenDraftFromAgent={openEmailDraftFromChat}
          onNewChat={closeOverlay}
          onUserInitiatedNewChat={historyNewChat}
          onOpenWikiAbout={() => navigateWikiPrimary()}
          onAfterDeleteChat={historyNewChat}
          onUserSendMessage={closeOverlayOnUserSend}
          onSessionChange={onSessionChangeFromAgent}
          onStreamingSessionsChange={(ids) => { shell.streamingSessionIds = ids }}
          onWriteStreaming={onWriteStreaming}
          onEditStreaming={onEditStreaming}
        >
          {#snippet mobileDetail()}
            {#if
              shell.route.overlay &&
              shell.route.overlay.type !== 'hub' &&
              shell.route.overlay.type !== 'chat-history'
            }
              <AssistantSlideOver
                bind:this={refs.mobileSlideOver}
                variant="mobile"
                overlay={shell.route.overlay}
                surfaceContext={shell.agentContext}
                wikiRefreshKey={shell.wikiRefreshKey}
                calendarRefreshKey={shell.calendarRefreshKey}
                inboxTargetId={shell.inboxTargetId}
                mailSearchResults={activeMailSearchResults}
                wikiStreamingWrite={shell.wikiWriteStreaming}
                wikiStreamingEdit={shell.wikiEditStreaming}
                onWikiNavigate={onWikiNavigate}
                onWikiDirNavigate={openWikiDir}
                onInboxNavigate={onInboxNavigateSlide}
                onContextChange={setContext}
                onOpenSearch={() => { shell.showSearch = true }}
                onSummarizeInbox={onSummarizeInbox}
                onCalendarResetToToday={resetCalendarToToday}
                onCalendarNavigate={switchToCalendar}
                toolOnOpenFile={openFileDoc}
                toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
                toolOnOpenDraft={(id, subj) => openEmailDraftFromChat(id, subj)}
                toolOnOpenFullInbox={openFullInboxFromChat}
                toolOnOpenMessageThread={openMessageThreadFromChat}
                onOpenWikiAbout={openHubWikiAbout}
                onClose={closeOverlay}
              />
            {/if}
          {/snippet}
        </AgentChat>
      {/if}
    {/snippet}
    {#snippet desktopDetail()}
      {#if
        shell.route.overlay &&
        shell.route.overlay.type !== 'hub' &&
        shell.route.overlay.type !== 'chat-history'
      }
        <AssistantSlideOver
          variant="desktop"
          overlay={shell.route.overlay}
          surfaceContext={shell.agentContext}
          wikiRefreshKey={shell.wikiRefreshKey}
          calendarRefreshKey={shell.calendarRefreshKey}
          inboxTargetId={shell.inboxTargetId}
          mailSearchResults={activeMailSearchResults}
          wikiStreamingWrite={shell.wikiWriteStreaming}
          wikiStreamingEdit={shell.wikiEditStreaming}
          onWikiNavigate={onWikiNavigate}
          onWikiDirNavigate={openWikiDir}
          onInboxNavigate={onInboxNavigateSlide}
          onContextChange={setContext}
          onOpenSearch={() => { shell.showSearch = true }}
          onSummarizeInbox={onSummarizeInbox}
          onCalendarResetToToday={resetCalendarToToday}
          onCalendarNavigate={switchToCalendar}
          toolOnOpenFile={openFileDoc}
          toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
          toolOnOpenDraft={(id, subj) => openEmailDraftFromChat(id, subj)}
          toolOnOpenFullInbox={openFullInboxFromChat}
          toolOnOpenMessageThread={openMessageThreadFromChat}
          onOpenWikiAbout={openHubWikiAbout}
          onClose={closeOverlay}
          detailFullscreen={shell.detailPaneFullscreen}
          onToggleFullscreen={() => refs.workspaceSplit?.toggleDetailFullscreen()}
        />
      {/if}
    {/snippet}
  </WorkspaceSplit>
    </div>
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .app-main-row {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }

  .workspace-column {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Scroll in .hub-scroll keeps this pane viewport-sized so the mobile slide-over (absolute inset 0) is not scrolled away with long hub content. */
  .hub-container {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }

  .hub-scroll {
    flex: 1;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .wiki-primary-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
  }

  .wiki-primary-crumbs {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2);
  }

  .wiki-primary-crumb-sep {
    opacity: 0.45;
    user-select: none;
    flex-shrink: 0;
  }

  .wiki-primary-crumb-btn {
    padding: 4px 2px;
    margin: -4px -2px;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    flex-shrink: 0;
    max-width: 100%;
  }

  .wiki-primary-crumb-btn:hover {
    color: var(--text);
  }

  .wiki-primary-crumb-current {
    color: var(--text);
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wiki-primary-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .wiki-primary-scroll {
    flex: 1;
    min-height: 0;
  }

  .wiki-primary-composer-dock {
    flex-shrink: 0;
    background: var(--bg);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .wiki-primary-composer-stack {
    max-width: var(--chat-column-max);
    width: 100%;
    margin-left: auto;
    margin-right: auto;
    box-sizing: border-box;
    padding: 8px clamp(12px, 3vw, 40px) 12px;
  }

  @media (min-width: 768px) {
    .wiki-primary-composer-stack {
      padding-left: clamp(16px, 4%, 40px);
      padding-right: clamp(16px, 4%, 40px);
    }
  }

  .mobile-detail-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .mobile-detail-layer :global(.slide-over) {
    border-left: none;
    flex: 1;
    min-height: 0;
  }

  .history-sidebar {
    min-height: 0;
  }

  .rail-inner {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .rail-panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /**
   * Desktop: in-flow flex child; enter/exit via `slide` (axis x) so width animates and the workspace reflows.
   * Mobile: fixed overlay above content (with backdrop); enter/exit via `fly` (transform).
   */
  .history-sidebar--slide {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-2);
  }

  @media (min-width: 768px) {
    .history-sidebar--slide {
      position: relative;
      flex-shrink: 0;
      width: var(--sidebar-history-w);
      max-width: min(var(--sidebar-history-w), 92vw);
      align-self: stretch;
    }
  }

  @media (max-width: 767px) {
    .history-sidebar--slide {
      position: fixed;
      left: 0;
      top: var(--tab-h);
      bottom: 0;
      width: var(--sidebar-history-mobile-w);
      max-width: 100%;
      z-index: 200;
    }
  }

  .sidebar-backdrop {
    position: fixed;
    left: 0;
    right: 0;
    top: var(--tab-h);
    bottom: 0;
    z-index: 199;
    background: rgba(0, 0, 0, 0.4);
  }
</style>
