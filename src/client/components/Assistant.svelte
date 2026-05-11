<script lang="ts">
  import { onMount, tick } from 'svelte'
import { get } from 'svelte/store'
  import { fly, slide } from 'svelte/transition'
  import { cn } from '@client/lib/cn.js'
  import Search from '@components/Search.svelte'
  import AppTopNav from '@components/AppTopNav.svelte'
import AppShell from '@components/app/AppShell.svelte'
  import SettingsConnectionsPage from '@components/settings/SettingsConnectionsPage.svelte'
  import SettingsWikiPage from '@components/settings/SettingsWikiPage.svelte'
  import BrainSettingsPage from '@components/BrainSettingsPage.svelte'
  import BrainHubPage from '@components/BrainHubPage.svelte'
  import BrainAccessPage from '@components/brain-access/BrainAccessPage.svelte'
  import PolicyDetailPage from '@components/brain-access/PolicyDetailPage.svelte'
  import Wiki from '@components/Wiki.svelte'
  import WikiDirList from '@components/WikiDirList.svelte'
  import WikiPrimaryShell from '@components/WikiPrimaryShell.svelte'
  import UnifiedChatComposer from '@components/UnifiedChatComposer.svelte'
  import AssistantSlideOver from '@components/AssistantSlideOver.svelte'
  import AnchoredMenuRow from '@components/shell/AnchoredMenuRow.svelte'
  import AgentChat from '@components/AgentChat.svelte'
  import ChatHistory from '@components/ChatHistory.svelte'
  import ChatHistoryPage from '@components/ChatHistoryPage.svelte'
  import WorkspaceSplit from '@components/WorkspaceSplit.svelte'
  import {
    parseRoute,
    readTailFromCache,
    rememberChatTail,
    routeToUrl,
    type Route,
    type RouteZone,
    type SurfaceContext,
    type Overlay,
    type NavigateOptions,
  } from '@client/router.js'
  import {
    CHAT_HISTORY_PAGE_LIST_LIMIT,
    CHAT_HISTORY_SIDEBAR_FETCH_LIMIT,
    fetchChatSessionListDeduped
      } from '@client/lib/chatHistorySessions.js'
  import { matchSessionIdByFlatPrefix } from '@client/lib/chatSessionTailResolve.js'
  import { applyHubDetailNavigation, applySettingsDetailNavigation } from '@client/lib/hubShellNavigate.js'
  import { overlaySupportsMobileChatBridge } from '@client/lib/mobileDetailChatOverlay.js'
  import { routeShowsWorkspaceSplitDetail } from '@client/lib/settings/settingsWorkspaceSplit.js'
  import {
    resolveSettingsPrimaryShell,
    selectedHubSourceFromOverlay,
  } from '@client/lib/settings/settingsPrimaryShell.js'
  import { mobileCompactNavCenterTitle } from '@client/lib/mobileCompactNavCenterTitle.js'
  import { runParallelSyncs } from '@client/lib/app/syncAllServices.js'
  import { matchGlobalShortcut } from '@client/lib/app/globalShortcuts.js'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { startHubEventsConnection } from '@client/lib/hubEvents/hubEventsClient.js'
  import {
    cancelPendingDebouncedWikiSync,
    onWikiMutatedForAutoSync,
    registerDebouncedWikiSyncRunner,
    runSyncOrQueueFollowUp
      } from '@client/lib/app/debouncedWikiSync.js'
  import { wikiPathForReadToolArg } from '@client/lib/cards/contentCards.js'
  import { wikiMarkdownBasenameDisplayTitle } from '@client/lib/wikiDirBreadcrumb.js'
  import {
    wikiPrimaryCrumbsForOverlay,
    type WikiPrimaryCrumb,
      } from '@client/lib/wikiPrimaryBarCrumbs.js'
  import WikiPrimaryBarCrumbs from '@components/WikiPrimaryBarCrumbs.svelte'
  import {
    MY_WIKI_SEGMENT,
    mergeWikiBrowseChildPath,
    parseUnifiedWikiBrowsePath
      } from '@client/lib/wikiDirListModel.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'
  import { navigateFromAgentOpen, type AgentOpenSource } from '@client/lib/navigateFromAgentOpen.js'
  import { WORKSPACE_DESKTOP_SPLIT_MIN_PX } from '@client/lib/app/workspaceLayout.js'
  import { fetchVaultStatus } from '@client/lib/vaultClient.js'
  import { postOnboardingFinalize } from '@client/lib/onboarding/onboardingApi.js'
  import { addToNavHistory, makeNavHistoryId, upsertEmailNavHistory } from '@client/lib/navHistory.js'
  import type { MailSearchResultsState } from '@client/lib/assistantShellModel.js'
  import {
    chatSessionPatch,
    closeOverlayStrategy,
    formatLocalDateYmd,
    hubActiveForOpenOverlay as hubActiveForOpenOverlayFromRoute,
    isNewChat,
    isStaleAgentSessionVersusChatBar,
    mobileOverflowMenuShowsChatSessionActions,
    shouldReplaceWikiOverlay
      } from '@client/lib/assistantShellNavigation.js'
  import { tryDismissTipTapFloatingMenuFromEscape } from '@client/lib/tiptapFloatingMenuEscape.js'
  import { waitUntilDefinedOrMaxTicks } from '@client/lib/async/waitUntilReady.js'
  import { alignShellWithBareChatRoute, createAssistantShellState, createShellNavigate } from '@client/lib/assistant/shell.js'
  import {
    nextMobileWikiOverlayStack,
    popMobileWikiOverlayStack
      } from '@client/lib/mobileWikiOverlayNav.js'
  import { contextPlaceholder, type SkillMenuItem } from '@client/lib/agentUtils.js'
  import { applyVoiceTranscriptToChat } from '@client/lib/voiceTranscribeRouting.js'
  import { readHearRepliesPreference } from '@client/lib/hearRepliesPreference.js'
  import { isPressToTalkEnabled } from '@client/lib/pressToTalkEnabled.js'
  import { registerWikiFileListRefetch } from '@client/lib/wikiFileListRefetch.js'
  import { wikiPrimaryChatMessageOrNull } from '@client/lib/wikiPrimaryChatSend.js'
  import { overlayForWikiPrimaryShortcut } from '@client/lib/wikiPrimaryShortcutOverlay.js'
  import { t } from '@client/lib/i18n/index.js'
  import type { WikiSlideHeaderState } from '@client/lib/wikiSlideHeaderContext.js'
  import {
    BookOpen,
    Search as SearchIcon,
    Settings,
    Trash2,
    Volume2,
    VolumeX
      } from 'lucide-svelte'

  type AssistantProps = {
    /** When false, hide brain-to-brain UI (`BRAIN_B2B_ENABLED` unset vs `1`/`true`). */
    brainQueryEnabled?: boolean
    /** Refetch vault + onboarding status after bootstrap completes (App passes shared refresher). */
    refreshAppOnboardingStatus?: () => Promise<void>
    /** Hosted vault — forwarded to Hub first-run panel copy. */
    multiTenant?: boolean
  }
  let {
    brainQueryEnabled = false,
    refreshAppOnboardingStatus,
    multiTenant = false,
  }: AssistantProps = $props()

  /**
   * `bind:this` targets — kept separate from shell state so refs stay obvious.
   * Inlined here so `AssistantSlideOver` / `WorkspaceSplit` types attach to these instances directly.
   */
  type AssistantRefsState = {
    agentChat?: AgentChat
    mobileSlideOver?: AssistantSlideOver
    workspaceSplit?: WorkspaceSplit
    chatHistory?: { refresh: (_opts?: { background?: boolean }) => Promise<void> }
  }

  /** Route bar, sync, overlays, and layout — one factory instead of a wall of `let` declarations. */
  let shell = $state(createAssistantShellState())

  const workspaceShowsSplitDetail = $derived(routeShowsWorkspaceSplitDetail(shell.route))
  const settingsPrimaryShell = $derived(
    resolveSettingsPrimaryShell(shell.route.overlay, brainQueryEnabled),
  )
  /** `bind:this` targets for AgentChat / WorkspaceSplit / slide stack / history list. */
  let refs = $state<AssistantRefsState>({})

  /** Pessimistic until GET /api/onboarding/status runs (avoids assuming `done` on first paint). */
  let onboardingMachineState = $state<string>('not-started')
  let lastBootstrapKickoffLocalKey = $state<string | null>(null)

  async function loadOnboardingMachineState() {
    try {
      const r = await fetch('/api/onboarding/status')
      const j = (await r.json()) as { state?: string }
      onboardingMachineState = typeof j.state === 'string' ? j.state : 'not-started'
    } catch {
      onboardingMachineState = 'not-started'
    }
  }

  /**
   * App-level onboarding/vault refresh (parent) + reload machine state here so the initial-bootstrap
   * `$effect` sees `onboarding-agent` after Hub PATCHes (otherwise chat stays empty until remount).
   */
  async function shellRefreshAppOnboardingStatus() {
    await refreshAppOnboardingStatus?.()
    await loadOnboardingMachineState()
  }

  /**
   * Interview `finish_conversation` / chip: jump to a fresh main chat immediately (same as non-onboarding).
   * Server finalize is slow; it runs in the background so the UI does not sit on the interview thread.
   */
  function handleInitialBootstrapFinished() {
    const sid = refs.agentChat?.getBackendSessionId()?.trim()
    historyNewChat()
    if (!sid) {
      console.warn('[initial-bootstrap] finalize skipped: no session id')
      return
    }
    /** Stops the bootstrap kickoff `$effect` from auto-sending on the new empty session while still `onboarding-agent`. */
    onboardingMachineState = 'done'
    void (async () => {
      try {
        await postOnboardingFinalize(sid)
        await shellRefreshAppOnboardingStatus()
      } catch (e) {
        console.warn('[initial-bootstrap] finalize failed', e)
        await loadOnboardingMachineState()
      }
    })()
  }

  $effect(() => {
    if (onboardingMachineState !== 'onboarding-agent') {
      lastBootstrapKickoffLocalKey = null
      return
    }
    void (async () => {
      const chat = await waitUntilDefinedOrMaxTicks({
        get: () => refs.agentChat,
        tick,
        maxIterations: 24,
      })
      if (!chat) return
      await tick()
      await tick()
      const key = chat.getDisplayedLocalSessionKey()
      if (!key || key === lastBootstrapKickoffLocalKey) return
      if (!chat.canSendInitialBootstrapKickoff()) return
      lastBootstrapKickoffLocalKey = key
      try {
        await chat.sendInitialBootstrapKickoff()
      } catch (e) {
        console.warn('[initial-bootstrap] kickoff failed', e)
        lastBootstrapKickoffLocalKey = null
      }
    })()
  })

  /** Wiki-primary bar chrome pushed from {@link WikiPrimaryShell} (no slide registration / `updateSeq`). */
  let wikiPrimarySlideHeader = $state<WikiSlideHeaderState | null>(null)

  const { navigateShell: navigateShellInner, optsWithBarTitle } = createShellNavigate(() => shell.chatTitleForUrl)

  /** Updates {@link shell.route} and mobile wiki overlay depth stack after each shell navigation. */
  function navigateShell(target: Route, opts?: NavigateOptions) {
    const prevOverlay = shell.route.overlay
    navigateShellInner(target, opts)
    shell.route = parseRoute()
    shell.mobileWikiOverlayStack = nextMobileWikiOverlayStack({
      isMobile: shell.isMobile,
      wikiPrimaryActive: shell.route.zone === 'wiki',
      suppressMutation: shell.suppressMobileWikiStackMutation,
      prevOverlay,
      nextOverlay: shell.route.overlay,
      priorStack: shell.mobileWikiOverlayStack
      })
  }

  function syncMobileWikiStackFromHubSettings(prevOverlay: Overlay | undefined) {
    shell.mobileWikiOverlayStack = nextMobileWikiOverlayStack({
      isMobile: shell.isMobile,
      wikiPrimaryActive: shell.route.zone === 'wiki',
      suppressMutation: shell.suppressMobileWikiStackMutation,
      prevOverlay,
      nextOverlay: shell.route.overlay,
      priorStack: shell.mobileWikiOverlayStack
      })
  }

  /** Mobile chat-column wiki overlay: ◀ pops one in-doc step before closing (see OPP-092). */
  function mobileWikiOverlayBack() {
    const o = shell.route.overlay
    if (!(shell.isMobile && o?.type === 'wiki')) {
      if (slideOverCloseAnimated) void refs.mobileSlideOver?.closeAnimated()
      else closeOverlay()
      return
    }
    const popped = popMobileWikiOverlayStack(shell.mobileWikiOverlayStack)
    if (popped.navigateToPath == null) {
      shell.mobileWikiOverlayStack = []
      if (slideOverCloseAnimated) void refs.mobileSlideOver?.closeAnimated()
      else closeOverlay()
      return
    }
    try {
      shell.suppressMobileWikiStackMutation = true
      shell.mobileWikiOverlayStack = popped.nextStack
      const overlay: Overlay = { type: 'wiki', path: popped.navigateToPath }
      const flags = routeSurfaceFlagsForOverlay(overlay)
      navigateShellInner(
        {
          overlay, zone: flags.zone,
          ...(flags.useChatSession ? chatSessionPart() : {})
      },
        optsWithBarTitle(),
      )
      shell.route = parseRoute()
      shell.mobileWikiOverlayStack = popped.nextStack
    } finally {
      shell.suppressMobileWikiStackMutation = false
    }
  }

  /** Invalidates in-flight `loadSession` when the bar's `/c/:id` changes again (back/forward). */
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
  const topNavNewChatDisabled = $derived(isNewChat(shell.route, effectiveChatSessionId))
  const isNewChatWithNothingToDelete = $derived(isNewChat(shell.route, effectiveChatSessionId))

  /** Primary wiki pane header: Wiki / folders / page (see `wiki-primary-bar`). */
  const wikiPrimaryBarCrumbs = $derived.by((): WikiPrimaryCrumb[] => {
    if (shell.route.zone !== 'wiki') return []
    const o = shell.route.overlay
    if (!o || (o.type !== 'wiki' && o.type !== 'wiki-dir')) return []
    return wikiPrimaryCrumbsForOverlay(o)
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
        duration: reduce ? 0 : SIDEBAR_TRANSITION_MS
      })
    }
    return slide(node, {
      axis: 'x',
      duration: reduce ? 0 : SIDEBAR_TRANSITION_MS
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
      if (e.key === 'Escape' && tryDismissTipTapFloatingMenuFromEscape()) {
        e.preventDefault()
        return
      }
      if (e.key === 'Escape' && shell.route.zone === 'wiki') {
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

    void loadOnboardingMachineState()

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
      { ...chatSessionPart() },
      { replace: true },
    )
    shell.route = parseRoute()
    alignShellWithBareChatRoute(shell)
  }

  function closeOverlayImmediate() {
    if (shell.route.zone === 'wiki') {
      closeWikiPrimary()
      return
    }
    if (shell.route.zone === 'settings') {
      navigateShell({ zone: 'settings' as RouteZone }, { replace: true })
    } else if (shell.route.zone === 'hub') {
      navigateShell({ zone: 'hub' as RouteZone }, { replace: true })
    } else {
      navigateShell(
        { ...chatSessionPart() },
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
    zone: RouteZone | undefined
    useChatSession: boolean
  } {
    const stayOnSurface = hubActiveForOpenOverlay(overlay)
    if (!stayOnSurface) {
      return { zone: undefined, useChatSession: true }
    }
    if (shell.route.zone === 'settings') {
      return { zone: 'settings', useChatSession: false }
    }
    return { zone: 'hub', useChatSession: false }
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
        { ...chatSessionPart() },
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
    const overlay = overlayForWikiPrimaryShortcut(path)
    const replace = shell.route.zone === 'wiki' && shouldReplaceWikiOverlay(shell.route)
    navigateShell({ zone: 'wiki', overlay }, replace ? { replace: true } : undefined)
    shell.route = parseRoute()
    const docPath = path?.trim()
    if (docPath) {
      void addToNavHistory({
        id: makeNavHistoryId('doc', docPath),
        type: 'doc',
        title: docPath,
        path: docPath
      })
    }
  }

  /** Open a wiki document from a **unified** path (`@handle/…`, `me/…`, or vault-relative). Mirrors `wikis/` layout in the overlay URL. */
  function openWikiDoc(unifiedPath?: string) {
    const p = unifiedPath?.trim() ?? ''
    const overlay: Overlay = p.length > 0 ? { type: 'wiki', path: p } : { type: 'wiki' }
    const replace = wikiOverlayReplace()
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell(
      {
        overlay, zone: flags.zone,
        ...(flags.useChatSession ? chatSessionPart() : {})
      },
      replace ? { replace: true } : undefined,
    )
    shell.route = parseRoute()
    if (p.length > 0) {
      void addToNavHistory({
        id: makeNavHistoryId('doc', p),
        type: 'doc',
        title: p,
        path: p
      })
    }
  }

  function onWikiNavigate(path: string | undefined) {
    const o = shell.route.overlay
    const parent = o?.type === 'wiki-dir' ? o : null
    const merged = mergeWikiBrowseChildPath(parent, path) ?? path
    if (merged === undefined) return
    const m = merged.trim().replace(/^\.\/+/, '')
    const parsed = parseUnifiedWikiBrowsePath(m)
    const vault = parsed.vaultRelPath.trim()
    const unified = m.startsWith('@') || m.startsWith('me/') ? m : vault.length > 0 ? vault : m
    const overlay: Overlay = { type: 'wiki', path: unified }
    if (shell.route.zone === 'wiki') {
      const replace = shouldReplaceWikiOverlay(shell.route)
      navigateShell({ zone: 'wiki', overlay }, replace ? { replace: true } : undefined)
      shell.route = parseRoute()
      return
    }
    const replace = wikiOverlayReplace()
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell(
      {
        overlay, zone: flags.zone,
        ...(flags.useChatSession ? chatSessionPart() : {})
      },
      replace ? { replace: true } : undefined,
    )
    shell.route = parseRoute()
  }

  function overlayForWikiDirNavigate(trimmed: string | undefined): Overlay {
    const t = trimmed?.trim()
    if (!t) return { type: 'wiki-dir' }
    if (t === 'me' || t === 'my-wiki' || t === MY_WIKI_SEGMENT) {
      return { type: 'wiki-dir' }
    }
    const parsed = parseUnifiedWikiBrowsePath(t)
    let path = parsed.vaultRelPath.replace(/\/+$/, '') || undefined
    if (path === 'my-wiki' || path === MY_WIKI_SEGMENT) path = undefined
    return path ? { type: 'wiki-dir', path } : { type: 'wiki-dir' }
  }

  function openWikiDir(dirPath?: string) {
    const o = shell.route.overlay
    const parent = o?.type === 'wiki-dir' ? o : null
    const merged = mergeWikiBrowseChildPath(parent, dirPath) ?? dirPath
    const overlay = overlayForWikiDirNavigate(merged)
    if (shell.route.zone === 'wiki') {
      const replace = shouldReplaceWikiOverlay(shell.route)
      navigateShell({ zone: 'wiki', overlay }, replace ? { replace: true } : undefined)
      shell.route = parseRoute()
      return
    }
    const replace = wikiOverlayReplace()
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell(
      {
        overlay, zone: flags.zone,
        ...(flags.useChatSession ? chatSessionPart() : {})
      },
      replace ? { replace: true } : undefined,
    )
    shell.route = parseRoute()
  }

  function openFileDoc(path: string) {
    const flags = routeSurfaceFlagsForOverlay({ type: 'file', path })
    navigateShell({
      overlay: { type: 'file', path }, zone: flags.zone,
      ...(flags.useChatSession ? chatSessionPart() : {})
      })
    shell.route = parseRoute()
    void addToNavHistory({
      id: makeNavHistoryId('doc', `file:${path}`),
      type: 'doc',
      title: path,
      path
      })
  }

  function openIndexedFileDoc(id: string, source?: string) {
    const overlay: Overlay = {
      type: 'indexed-file',
      id,
      ...(source?.trim() ? { source: source.trim() } : {})
      }
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell({
      overlay, zone: flags.zone,
      ...(flags.useChatSession ? chatSessionPart() : {})
      })
    shell.route = parseRoute()
    shell.agentContext = {
      type: 'indexed-file',
      id,
      title: '(loading)',
      sourceKind: '',
      ...(source?.trim() ? { source: source.trim() } : {})
      }
  }

  function onInboxNavigateSlide(id: string | undefined) {
    const overlay: Overlay = id ? { type: 'email', id } : { type: 'email' }
    const flags = routeSurfaceFlagsForOverlay(overlay)
    const nextRoute: Route = flags.useChatSession
      ? { ...chatSessionPart(), overlay }
      : {
          zone: flags.zone,
          overlay,
      }
    const nextUrl = routeToUrl(nextRoute, optsWithBarTitle())
    if (typeof location !== 'undefined' && nextUrl === `${location.pathname}${location.search}`) {
      return
    }
    navigateShell({
      overlay, zone: flags.zone,
      ...(flags.useChatSession ? chatSessionPart() : {})
      })
    shell.route = parseRoute()
  }

  function switchToCalendar(date: string, eventId?: string) {
    const overlay: Overlay = { type: 'calendar', date, ...(eventId ? { eventId } : {}) }
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell({
      overlay, zone: flags.zone,
      ...(flags.useChatSession ? chatSessionPart() : {})
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
      overlay: { type: 'email', id }, zone: flags.zone,
      ...(flags.useChatSession ? chatSessionPart() : {})
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
      overlay: { type: 'email-draft', id: draftId }, zone: flags.zone,
      ...(flags.useChatSession ? chatSessionPart() : {})
      })
    shell.route = parseRoute()
    shell.agentContext = {
      type: 'email-draft',
      draftId,
      subject: subject?.trim() || '(loading)',
      toLine: '',
      bodyPreview: ''
      }
  }

  function openFullInboxFromChat() {
    shell.inboxTargetId = undefined
    navigateShell({
      ...chatSessionPart(),
      overlay: { type: 'email' }
      })
    shell.route = parseRoute()
  }

  function openMailSearchResultsFromChat(preview: MailSearchResultsState, sourceId: string) {
    const id = sourceId.trim() || `mail-search-${Date.now()}`
    shell.mailSearchResults = { ...shell.mailSearchResults, [id]: preview }
    const overlay: Overlay = { type: 'mail-search', id, query: preview.queryLine }
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell({
      overlay, zone: flags.zone,
      ...(flags.useChatSession ? chatSessionPart() : {})
      })
    shell.route = parseRoute()
    shell.agentContext = { type: 'mail-search', query: preview.queryLine }
  }

  function openMessageThreadFromChat(canonicalChat: string, displayLabel: string) {
    const overlay: Overlay = { type: 'messages', chat: canonicalChat }
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell({
      overlay, zone: flags.zone,
      ...(flags.useChatSession ? chatSessionPart() : {})
      })
    shell.route = parseRoute()
    shell.agentContext = { type: 'messages', chat: canonicalChat, displayLabel }
  }

  /** Brain Hub rows → same detail stack as chat (`SlideOver` + `Overlay`). */
  function navigateFromHub(overlay: Overlay, opts?: NavigateOptions) {
    const prevOverlay = shell.route.overlay
    const hubActiveForNav = !shell.isMobile || !overlaySupportsMobileChatBridge(overlay)
    const routeForNav: Route = {
      ...shell.route,
      sessionId: effectiveChatSessionId ?? shell.route.sessionId,
      sessionTail: undefined,
    }
    applyHubDetailNavigation(routeForNav, overlay, optsWithBarTitle(opts), hubActiveForNav)
    shell.route = parseRoute()
    syncMobileWikiStackFromHubSettings(prevOverlay)
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
    const prevOverlay = shell.route.overlay
    const settingsColumnActive = !shell.isMobile || !overlaySupportsMobileChatBridge(overlay)
    const routeForNav: Route = {
      ...shell.route,
      sessionId: effectiveChatSessionId ?? shell.route.sessionId,
      sessionTail: undefined
      }
    applySettingsDetailNavigation(routeForNav, overlay, optsWithBarTitle(opts), settingsColumnActive)
    shell.route = parseRoute()
    syncMobileWikiStackFromHubSettings(prevOverlay)
    if (overlay.type === 'wiki' && overlay.path) {
      void addToNavHistory({
        id: makeNavHistoryId('doc', overlay.path),
        type: 'doc',
        title: overlay.path,
        path: overlay.path
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

  /** LLM `open` — navigate on tool_start. Mail / indexed reads are preview-only until the user opens them or the model uses `open`. */
  function onOpenFromAgent(
    target: { type: string; path?: string; id?: string; date?: string; source?: string },
    source: AgentOpenSource,
  ) {
    navigateFromAgentOpen(target, {
      source,
      isMobile: !useDesktopSplitDetail,
      openWikiDoc: (path) => openWikiDoc(path),
      openFileDoc: (path) => openFileDoc(path),
      openIndexedFileDoc: (fid, src) => openIndexedFileDoc(fid, src),
      openEmailFromSearch,
      switchToCalendar
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
    navigateShell({ sessionId: id }, { replace: true })
    shell.route = parseRoute()
    alignShellWithBareChatRoute(shell)
    const chat = await waitUntilDefinedOrMaxTicks({
      get: () => refs.agentChat,
      tick,
      maxIterations: 16
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

  /**
   * New pending chat at the main column URL: empty `Route` + replace → `/c` via `routeToUrl` in `router.ts`
   * (see `chatBasePath` when no session id).
   */
  function historyNewChat() {
    shell.chatTitleForUrl = null
    navigateShell({ }, { replace: true })
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
      wikiDockWikiFiles = parseWikiListApiBody(data).files.map((f) => f.path)
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
        ...(keepDetailForSplit ? { overlay: o } : {})
      },
      { replace: true },
    )
    shell.route = parseRoute()

    if (keepDetailForSplit && o) {
      shell.wikiWriteStreaming = null
      shell.wikiEditStreaming = null
      shell.inboxTargetId = undefined
      if (o.type === 'wiki' && o.path) {
        const title = wikiMarkdownBasenameDisplayTitle(o.path)
        shell.agentContext = { type: 'wiki', path: o.path, title }
      } else if (o.type === 'wiki-dir') {
        const dirPath = o.path?.trim() ?? ''
        const title = dirPath
          ? (dirPath.split('/').pop() ?? dirPath)
          : get(t)('nav.wiki.label', 'Wiki')
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
      maxIterations: 48
      })
    if (chat) await chat.newChatWithMessage(t, { skipOverlayClose: true })
  }

  $effect(() => {
    if (shell.route.zone !== 'wiki') return
    void fetchWikiDockWikiFiles()
    void fetchWikiDockSkills()
    return registerWikiFileListRefetch(fetchWikiDockWikiFiles)
  })

  /** Empty-state "your wiki" → same help as Hub (`HubWikiAboutPanel` in SlideOver / mobile stack). */
  function openHubWikiAbout() {
    const onHubLike = shell.route.zone === 'hub' || shell.route.zone === 'settings'
    navigateShell({
      overlay: { type: 'hub-wiki-about' },
      zone: shell.route.zone === 'hub' || shell.route.zone === 'settings' ? shell.route.zone : undefined,
      ...(onHubLike ? {} : chatSessionPart()),
    })
    shell.route = parseRoute()
  }

  function openChatHistoryPage() {
    const onHubLike = shell.route.zone === 'hub' || shell.route.zone === 'settings'
    navigateShell({
      overlay: { type: 'chat-history' },
      zone: shell.route.zone === 'hub' || shell.route.zone === 'settings' ? shell.route.zone : undefined,
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
      shell.route.zone === 'hub' ||
      shell.route.zone === 'settings' ||
      shell.route.zone === 'wiki'
    )
      return
    const navRoute: Route = {
      sessionId: id,
      overlay: shell.route.overlay
      }
    const nextUrl = routeToUrl(navRoute, optsWithBarTitle())
    if (typeof location !== 'undefined' && nextUrl === `${location.pathname}${location.search}`) {
      return
    }
    navigateShell(
      { sessionId: id, overlay: shell.route.overlay },
      { replace: true },
    )
    shell.route = parseRoute()
  }

  $effect(() => {
    const sid = effectiveChatSessionId
    const onChat =
      !shell.route.flow &&
      shell.route.zone !== 'hub' &&
      shell.route.zone !== 'settings' &&
      shell.route.zone !== 'wiki' &&
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
        shouldAbort: () => gen !== urlSessionSyncGen
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
    navigateShell({ zone: 'settings' as RouteZone })
    shell.route = parseRoute()
    if (shell.isMobile) shell.sidebarOpen = false
  }

  function openBrainAccessSettings() {
    navigateShell({ zone: 'settings', overlay: { type: 'brain-access' } })
    if (shell.isMobile) shell.sidebarOpen = false
  }

  /** When brain-to-brain is disabled, strip brain-access overlays so `/settings/brain-access` URLs fall back to Settings. */
  $effect(() => {
    if (brainQueryEnabled) return
    const o = shell.route.overlay
    if (o?.type === 'brain-access' || o?.type === 'brain-access-policy') {
      navigateShell({ zone: 'settings' })
      shell.route = parseRoute()
    }
  })

  function onEditStreaming(p: { id: string; path: string; done: boolean }) {
    if (p.done) {
      if (shell.wikiEditStreaming?.toolId === p.id) shell.wikiEditStreaming = null
      return
    }
    if (p.path) {
      shell.wikiEditStreaming = { path: wikiPathForReadToolArg(p.path), toolId: p.id }
    }
  }

  /** Tracks the current chat's hearReplies state for the mobile overflow menu label/icon. */
  let chatHearReplies = $state(false)

  /** Mobile chat/hub/settings columns: compact L1 per OPP-092 (wiki-primary keeps labeled icons). */
  const appMobileNavCompact = $derived(shell.isMobile && shell.route.zone !== 'wiki')
  const appMobileNavCenterTitle = $derived(
    appMobileNavCompact
      ? mobileCompactNavCenterTitle(shell.route, shell.agentContext, shell.chatTitleForUrl, effectiveChatSessionId)
      : undefined,
  )
  const showMobileOverflowChatSessionActions = $derived(mobileOverflowMenuShowsChatSessionActions(shell.route))
</script>

{#if shell.showSearch}
  <Search
    onOpenWiki={(path) => { openWikiDoc(path); shell.showSearch = false }}
    onWikiHome={navigateWikiPrimary}
    onOpenEmail={(id, subject, from) => { openEmailFromSearch(id, subject, from); shell.showSearch = false }}
    onClose={() => shell.showSearch = false}
  />
{/if}

{#snippet mobileNavOverflowMenu({ dismiss })}
    <AnchoredMenuRow
      label={$t('common.actions.search')}
      onclick={() => {
        shell.showSearch = true
        dismiss()
      }}
    >
      {#snippet leading()}
        <SearchIcon size={18} strokeWidth={2} aria-hidden="true" />
      {/snippet}
    </AnchoredMenuRow>
    <AnchoredMenuRow
      label={$t('nav.wiki.home')}
      onclick={() => {
        navigateWikiPrimary()
        dismiss()
      }}
    >
      {#snippet leading()}
        <BookOpen size={18} strokeWidth={2} aria-hidden="true" />
      {/snippet}
    </AnchoredMenuRow>
    <AnchoredMenuRow
      label={$t('nav.settings.label')}
      onclick={() => {
        openSettings()
        dismiss()
      }}
    >
      {#snippet leading()}
        <Settings size={18} strokeWidth={2} aria-hidden="true" />
      {/snippet}
    </AnchoredMenuRow>
    {#if showMobileOverflowChatSessionActions}
      <AnchoredMenuRow
        label={
          chatHearReplies
            ? $t('chat.assistant.mobileOverflow.turnAudioOff')
            : $t('chat.assistant.mobileOverflow.turnAudioOn')
        }
        onclick={() => {
          refs.agentChat?.toggleHearRepliesFromHeader()
          dismiss()
        }}
      >
        {#snippet leading()}
          {#if chatHearReplies}
            <VolumeX size={18} strokeWidth={2} aria-hidden="true" />
          {:else}
            <Volume2 size={18} strokeWidth={2} aria-hidden="true" />
          {/if}
        {/snippet}
      </AnchoredMenuRow>
      {#if !isNewChatWithNothingToDelete}
        <AnchoredMenuRow
          label={$t('chat.agentChat.deleteChatAria')}
          onclick={() => {
            refs.agentChat?.requestDeleteCurrentChat()
            dismiss()
          }}
        >
          {#snippet leading()}
            <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
          {/snippet}
        </AnchoredMenuRow>
      {/if}
    {/if}
  {/snippet}

<AppShell>
  {#snippet topNav()}
  <AppTopNav
    isMobile={shell.isMobile}
    sidebarOpen={shell.sidebarOpen}
    onToggleSidebar={toggleSidebar}
    syncErrors={shell.syncErrors}
    showSyncErrors={shell.showSyncErrors}
    onOpenSearch={() => { shell.showSearch = true }}
    onToggleSyncErrors={() => { shell.showSyncErrors = !shell.showSyncErrors }}
    onOpenSettings={openSettings}
    onNewChat={historyNewChat}
    onWikiHome={() => navigateWikiPrimary()}
    isEmptyChat={topNavNewChatDisabled}
    hostedHandlePill={shell.hostedHandleNav}
    onOpenSharing={brainQueryEnabled ? openBrainAccessSettings : undefined}
    mobileCenterTitle={appMobileNavCenterTitle}
    mobileOverflow={appMobileNavCompact ? mobileNavOverflowMenu : undefined}
    mobileOverflowAlert={appMobileNavCompact && shell.syncErrors.length > 0}
  />
  {/snippet}

  {#snippet sidebar()}
    {#if shell.sidebarOpen}
      {#if shell.isMobile}
        <div
          class="sidebar-backdrop fixed inset-x-0 bottom-0 z-[199] bg-black/40 [top:var(--tab-h)]"
          role="presentation"
          aria-hidden="true"
          onclick={() => { shell.sidebarOpen = false }}
        ></div>
      {/if}
      <aside
        class={cn(
          'history-sidebar history-sidebar--slide flex min-h-0 flex-col border-r border-border bg-surface-2',
          'md:relative md:shrink-0 md:w-sidebar-history md:max-w-[min(var(--sidebar-history-w),92vw)] md:self-stretch',
          'max-md:fixed max-md:left-0 max-md:bottom-0 max-md:z-[200] max-md:w-sidebar-history-mobile max-md:max-w-full max-md:[top:var(--tab-h)]',
        )}
        in:historySidebarTransition={{ mobile: shell.isMobile, reduce: shell.reduceSidebarMotion }}
        out:historySidebarTransition={{ mobile: shell.isMobile, reduce: shell.reduceSidebarMotion }}
      >
        <div class="rail-inner flex min-h-0 flex-1 flex-col">
          <div class="rail-panel rail-panel--chat flex min-h-0 flex-1 flex-col">
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
  {/snippet}

  {#snippet workspace()}
    <div class="workspace-column flex min-h-0 min-w-0 flex-1 flex-col" bind:clientWidth={shell.workspaceColumnWidth}>
      <WorkspaceSplit
        bind:this={refs.workspaceSplit}
        workspaceColumnWidthPx={shell.workspaceColumnWidth}
        bind:detailFullscreen={shell.detailPaneFullscreen}
        hasDetail={workspaceShowsSplitDetail}
        desktopDetailOpen={workspaceShowsSplitDetail && useDesktopSplitDetail}
        onNavigateClear={closeOverlayImmediate}
      >
        {#snippet chat()}
          {#if shell.route.overlay?.type === 'chat-history'}
            <div class="hub-container relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div class="hub-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                <ChatHistoryPage
                  activeSessionId={sessionHighlightId}
                  streamingSessionIds={shell.streamingSessionIds}
                  onSelectSession={selectChatSession}
                  onNewChat={historyNewChat}
                />
              </div>
            </div>
          {:else if shell.route.zone === 'wiki' && shell.route.overlay && (shell.route.overlay.type === 'wiki' || shell.route.overlay.type === 'wiki-dir')}
            <div class="hub-container relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <WikiPrimaryShell bind:wikiSlideHeader={wikiPrimarySlideHeader}>
                {#snippet bar()}
                  <div class="wiki-primary-bar flex shrink-0 items-center justify-between gap-2.5 border-b border-border bg-surface-2 px-2.5 py-1.5">
                    <WikiPrimaryBarCrumbs crumbs={wikiPrimaryBarCrumbs} onOpenWikiDir={openWikiDir} />
                    <div class="wiki-primary-actions flex shrink-0 items-center gap-2" role="toolbar" aria-label={$t('chat.assistant.wikiActionsToolbarAria')}>
                      {#if shell.route.overlay.type === 'wiki' && wikiPrimarySlideHeader}
                        {#if wikiPrimarySlideHeader.saveState === 'saving'}
                          <span class="wiki-save-hint text-xs font-semibold text-accent" role="status">{$t('common.status.saving')}</span>
                        {:else if wikiPrimarySlideHeader.saveState === 'saved'}
                          <span class="wiki-save-hint text-xs font-semibold text-accent" role="status">{$t('common.status.saved')}</span>
                        {:else if wikiPrimarySlideHeader.saveState === 'error'}
                          <span class="wiki-save-hint wiki-save-err text-xs font-semibold text-[var(--text-3,var(--text-2))]" role="status">{$t('common.status.saveFailed')}</span>
                        {/if}
                      {/if}
                    </div>
                  </div>
                {/snippet}
                {#snippet children()}
                  <div class="wiki-primary-main flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div class="hub-scroll wiki-primary-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                      {#if shell.route.overlay.type === 'wiki'}
                        <Wiki
                          initialPath={shell.route.overlay.path}
                          refreshKey={shell.wikiRefreshKey}
                          streamingWrite={shell.wikiWriteStreaming}
                          streamingEdit={shell.wikiEditStreaming}
                          onNavigate={(path) => onWikiNavigate(path)}
                          onNavigateToDir={openWikiDir}
                          onContextChange={setContext}
                          onCalendarNavigate={switchToCalendar}
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
                    <div class="wiki-primary-composer-dock shrink-0 bg-surface [padding-bottom:env(safe-area-inset-bottom,0px)]">
                      <div class="wiki-primary-composer-stack mx-auto box-border w-full max-w-chat px-[clamp(12px,3vw,40px)] pb-3 pt-2 md:px-[clamp(16px,4%,40px)]">
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
                {/snippet}
              </WikiPrimaryShell>
            </div>
          {:else if shell.route.zone === 'hub' || shell.route.overlay?.type === 'hub'}
            <div class="hub-container relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div class="hub-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                <BrainHubPage
                  brainQueryEnabled={brainQueryEnabled}
                  onHubNavigate={navigateFromHub}
                  onOpenSettings={openSettings}
                  onOpenBrainAccess={openBrainAccessSettings}
                />
              </div>
              {#if
                !useDesktopSplitDetail &&
                shell.route.overlay &&
                shell.route.overlay.type !== 'hub' &&
                shell.route.overlay.type !== 'chat-history'
              }
                <div class="mobile-detail-layer absolute inset-0 z-10 flex min-h-0 flex-col">
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
                    toolOnOpenIndexedFile={openIndexedFileDoc}
                    toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
                    toolOnOpenDraft={(id, subj) => openEmailDraftFromChat(id, subj)}
                    toolOnOpenFullInbox={openFullInboxFromChat}
                    toolOnOpenMessageThread={openMessageThreadFromChat}
                    onOpenWikiAbout={openHubWikiAbout}
                    onMobileWikiOverlayBack={mobileWikiOverlayBack}
                    onClose={closeOverlay}
                  />
                </div>
              {/if}
            </div>
          {:else if shell.route.zone === 'settings'}
            <div class="hub-container relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div class="hub-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                {#if settingsPrimaryShell === 'connections'}
                  <SettingsConnectionsPage
                    onSettingsNavigate={navigateFromSettings}
                    selectedHubSourceId={selectedHubSourceFromOverlay(shell.route.overlay)}
                    onNavigateToSettingsRoot={() => navigateShell({ zone: 'settings' })}
                  />
                {:else if settingsPrimaryShell === 'wiki'}
                  <SettingsWikiPage
                    onSettingsNavigate={navigateFromSettings}
                    onNavigateToSettingsRoot={() => navigateShell({ zone: 'settings' })}
                  />
                {:else if settingsPrimaryShell === 'brain-access-list'}
                  <BrainAccessPage
                    onSettingsNavigate={navigateFromSettings}
                    onBackToSettingsMain={() => navigateShell({ zone: 'settings' })}
                  />
                {:else if settingsPrimaryShell === 'brain-access-policy'}
                  <PolicyDetailPage
                    policyId={shell.route.overlay!.policyId}
                    onSettingsNavigate={navigateFromSettings}
                    onNavigateToSettingsRoot={() => navigateShell({ zone: 'settings' })}
                    onBackToBrainAccessList={() =>
                      navigateShell({ zone: 'settings', overlay: { type: 'brain-access' } })}
                  />
                {:else}
                  <BrainSettingsPage
                    brainQueryEnabled={brainQueryEnabled}
                    multiTenant={multiTenant}
                    onSettingsNavigate={navigateFromSettings}
                    selectedHubSourceId={selectedHubSourceFromOverlay(shell.route.overlay)}
                  />
                {/if}
              </div>
              {#if !useDesktopSplitDetail && workspaceShowsSplitDetail}
                <div class="mobile-detail-layer absolute inset-0 z-10 flex min-h-0 flex-col">
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
                    toolOnOpenIndexedFile={openIndexedFileDoc}
                    toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
                    toolOnOpenDraft={(id, subj) => openEmailDraftFromChat(id, subj)}
                    toolOnOpenFullInbox={openFullInboxFromChat}
                    toolOnOpenMessageThread={openMessageThreadFromChat}
                    onOpenWikiAbout={openHubWikiAbout}
                    onMobileWikiOverlayBack={mobileWikiOverlayBack}
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
              suppressMobileChatL2Header={shell.isMobile && !!shell.route.overlay && !useDesktopSplitDetail}
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
              onOpenIndexedFile={openIndexedFileDoc}
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
              onAgentFinishConversation={() =>
                onboardingMachineState === 'onboarding-agent'
                  ? handleInitialBootstrapFinished()
                  : historyNewChat()}
              onOpenWikiAbout={() => navigateWikiPrimary()}
              onAfterDeleteChat={historyNewChat}
              onUserSendMessage={closeOverlayOnUserSend}
              onSessionChange={onSessionChangeFromAgent}
              onStreamingSessionsChange={(ids) => { shell.streamingSessionIds = ids }}
              onWriteStreaming={onWriteStreaming}
              onEditStreaming={onEditStreaming}
              onHearRepliesChange={(on) => { chatHearReplies = on }}
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
                    toolOnOpenIndexedFile={openIndexedFileDoc}
                    toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
                    toolOnOpenDraft={(id, subj) => openEmailDraftFromChat(id, subj)}
                    toolOnOpenFullInbox={openFullInboxFromChat}
                    toolOnOpenMessageThread={openMessageThreadFromChat}
                    onOpenWikiAbout={openHubWikiAbout}
                    onMobileWikiOverlayBack={mobileWikiOverlayBack}
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
              toolOnOpenIndexedFile={openIndexedFileDoc}
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
  {/snippet}
</AppShell>

<style>
  /* Hub / settings mobile overlays: fill layer and strip slide-over chrome (scoped; do not put
     `:global(...)` inside Tailwind class strings — that emits invalid selectors into globals.css.) */
  .mobile-detail-layer :global(.slide-over) {
    border-left: none;
    flex: 1;
    min-height: 0;
  }
</style>
