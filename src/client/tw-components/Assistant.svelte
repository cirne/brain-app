<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fly, slide } from 'svelte/transition'
  import { cn } from '@client/lib/cn.js'
  import Search from '@tw-components/Search.svelte'
  import AppTopNav from '@tw-components/AppTopNav.svelte'
  import BrainHubPage from '@tw-components/BrainHubPage.svelte'
  import BrainSettingsPage from '@tw-components/BrainSettingsPage.svelte'
  import Wiki from '@tw-components/Wiki.svelte'
  import WikiDirList from '@tw-components/WikiDirList.svelte'
  import WikiPrimaryShell from '@tw-components/WikiPrimaryShell.svelte'
  import UnifiedChatComposer from '@tw-components/UnifiedChatComposer.svelte'
  import AssistantSlideOver from '@tw-components/AssistantSlideOver.svelte'
  // TODO(tw): switch to @tw-components when migrated
  import AgentChat from '@components/AgentChat.svelte'
  import ChatHistory from '@tw-components/ChatHistory.svelte'
  import ChatHistoryPage from '@tw-components/ChatHistoryPage.svelte'
  import WorkspaceSplit from '@tw-components/WorkspaceSplit.svelte'
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
    wikiPrimaryCrumbsForMyWikiDir,
    wikiPrimaryCrumbsForMyWikiFile,
    wikiPrimaryCrumbsForSharedDir,
    wikiPrimaryCrumbsForSharedFile,
    type WikiPrimaryCrumb,
  } from '@client/lib/wikiPrimaryBarCrumbs.js'
  import {
    MY_WIKI_SEGMENT,
    MY_WIKI_URL_SEGMENT,
    mergeWikiBrowseChildPath,
    parseUnifiedWikiBrowsePath,
  } from '@client/lib/wikiDirListModel.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'
  import { navigateFromAgentOpen, type AgentOpenSource } from '@client/lib/navigateFromAgentOpen.js'
  import { WORKSPACE_DESKTOP_SPLIT_MIN_PX } from '@client/lib/app/workspaceLayout.js'
  import { fetchVaultStatus } from '@client/lib/vaultClient.js'
  import { fetchWikiSharesList } from '@client/lib/wikiSharesClient.js'
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
  import type { WikiSlideHeaderRegistration, WikiSlideHeaderState } from '@client/lib/wikiSlideHeaderContext.js'
  import { Pencil, Save, Share2 } from 'lucide-svelte'

  /**
   * `bind:this` targets — kept separate from shell state so refs stay obvious.
   * Inlined here (vs the legacy `assistantShellRefs.ts`) so the tw-components
   * `AssistantSlideOver` / `WorkspaceSplit` types are bound to the tw-components instances.
   */
  type AssistantRefsState = {
    agentChat?: AgentChat
    mobileSlideOver?: AssistantSlideOver
    workspaceSplit?: WorkspaceSplit
    chatHistory?: { refresh: (_opts?: { background?: boolean }) => Promise<void> }
  }

  /** Route bar, sync, overlays, and layout — one factory instead of a wall of `let` declarations. */
  let shell = $state(createAssistantShellState())
  /** `bind:this` targets for AgentChat / WorkspaceSplit / slide stack / history list. */
  let refs = $state<AssistantRefsState>({})

  /** Wiki-primary slide header registration (edit / share) when wiki is the main surface. */
  let wikiPrimaryHdr = $state<WikiSlideHeaderRegistration | null>(null)

  function wikiShareAudienceBadgePrimary(n: number | undefined): string {
    const c = n ?? 0
    return c > 9 ? '9+' : `${c}`
  }

  function wikiPrimaryShareTitle(hdr: WikiSlideHeaderState): string {
    const n = hdr.shareAudienceCount ?? 0
    return n > 0 ? `Shared with ${n} people — manage access` : 'Share'
  }

  function wikiPrimaryShareAria(hdr: WikiSlideHeaderState): string {
    const n = hdr.shareAudienceCount ?? 0
    return n > 0 ? `Shared with ${n} people; manage access.` : 'Share'
  }

  const { navigateShell, optsWithBarTitle } = createShellNavigate(() => shell.chatTitleForUrl)

  function wikiShareOptsFromRoute(): {
    shareOwner?: string
    sharePrefix?: string
    shareHandle?: string
  } {
    const o = shell.route.overlay
    if (!o) return {}
    if (o.type !== 'wiki' && o.type !== 'wiki-dir') return {}
    const out: {
      shareOwner?: string
      sharePrefix?: string
      shareHandle?: string
    } = {}
    const so = o.shareOwner?.trim()
    const sp = o.sharePrefix?.trim()
    let sh = o.shareHandle?.trim()
    if (!sh && o.path) {
      const parsed = parseUnifiedWikiBrowsePath(o.path)
      sh = parsed.shareHandle?.trim()
    }
    if (so) out.shareOwner = so
    if (sp) out.sharePrefix = sp
    if (sh) out.shareHandle = sh
    return out
  }

  function openSharedWiki(p: { ownerId: string; pathPrefix: string; ownerHandle?: string }) {
    const raw = p.pathPrefix.trim()
    const sharePrefix = raw.endsWith('/') ? raw : `${raw}/`
    const dirPath = sharePrefix.replace(/\/$/, '') || undefined
    const handle = p.ownerHandle?.trim()
    const overlay: Overlay = {
      type: 'wiki-dir',
      path: dirPath,
      shareOwner: p.ownerId,
      sharePrefix,
      ...(handle ? { shareHandle: handle } : {}),
    }
    if (shell.route.wikiActive) {
      const replace = shouldReplaceWikiOverlay(shell.route)
      navigateShell({ wikiActive: true, overlay }, replace ? { replace: true } : undefined)
    } else {
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
    }
    shell.route = parseRoute()
  }

  function openSharedWikiFile(p: { ownerId: string; filePath: string; ownerHandle?: string }) {
    const path = p.filePath.trim()
    if (!path.endsWith('.md')) return
    const handle = p.ownerHandle?.trim()
    const overlay: Overlay = {
      type: 'wiki',
      path,
      shareOwner: p.ownerId,
      sharePrefix: path,
      ...(handle ? { shareHandle: handle } : {}),
    }
    if (shell.route.wikiActive) {
      const replace = shouldReplaceWikiOverlay(shell.route)
      navigateShell({ wikiActive: true, overlay }, replace ? { replace: true } : undefined)
    } else {
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
    }
    shell.route = parseRoute()
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
  const topNavNewChatDisabled = $derived(shouldDisableTopNavNewChat(shell.route, effectiveChatSessionId))

  /** Primary wiki pane header: Wiki / folders / page (see `wiki-primary-bar`). */
  const wikiPrimaryBarCrumbs = $derived.by((): WikiPrimaryCrumb[] => {
    if (!shell.route.wikiActive) return []
    const o = shell.route.overlay
    if (!o || (o.type !== 'wiki' && o.type !== 'wiki-dir')) return []
    const sh = o.shareHandle?.trim()
    if (sh) {
      return o.type === 'wiki'
        ? wikiPrimaryCrumbsForSharedFile(sh, o.path?.trim() ?? '')
        : wikiPrimaryCrumbsForSharedDir(sh, o.path)
    }
    const p = o.path?.trim() ?? ''
    if (
      p === MY_WIKI_SEGMENT ||
      p.startsWith(`${MY_WIKI_SEGMENT}/`) ||
      p === MY_WIKI_URL_SEGMENT ||
      p.startsWith(`${MY_WIKI_URL_SEGMENT}/`) ||
      p === 'my-wiki' ||
      p.startsWith('my-wiki/') ||
      p === 'me' ||
      p.startsWith('me/')
    ) {
      const localRel =
        p === MY_WIKI_SEGMENT || p === MY_WIKI_URL_SEGMENT || p === 'my-wiki' || p === 'me'
          ? ''
          : p.startsWith(`${MY_WIKI_URL_SEGMENT}/`)
            ? p.slice(MY_WIKI_URL_SEGMENT.length + 1)
            : p.startsWith('my-wiki/')
              ? p.slice('my-wiki/'.length)
              : p.startsWith(`${MY_WIKI_SEGMENT}/`)
                ? p.slice(MY_WIKI_SEGMENT.length + 1)
                : p.startsWith('me/')
                  ? p.slice('me/'.length)
                  : ''
      return o.type === 'wiki'
        ? wikiPrimaryCrumbsForMyWikiFile(localRel)
        : wikiPrimaryCrumbsForMyWikiDir(localRel || undefined)
    }
    return o.type === 'wiki'
      ? wikiPrimaryCrumbsForFile(o.path?.trim() ?? '')
      : wikiPrimaryCrumbsForDir(o.path)
  })

  /** Bare `/wiki` hub lists My Wiki + shares; with no received shares, redirect to `/wiki/me/`. */
  $effect(() => {
    if (!shell.route.wikiActive) return
    const o = shell.route.overlay
    if (!o || o.type !== 'wiki-dir') return
    if (o.path?.trim() || o.shareHandle?.trim() || o.shareOwner?.trim()) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/wiki')
        if (!res.ok) return
        const received = parseWikiListApiBody(await res.json()).shares.received
        if (cancelled || received.length > 0) return
        navigateShell(
          { wikiActive: true, overlay: { type: 'wiki-dir', path: MY_WIKI_URL_SEGMENT } },
          { replace: true },
        )
        shell.route = parseRoute()
      } catch {
        /* keep browsing hub on fetch failure */
      }
    })()
    return () => {
      cancelled = true
    }
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
    const h = 'shareHandle' in o ? (o.shareHandle ?? '') : ''
    return `wiki-primary-${o.type}-${h}-${p}`
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
      .finally(() => {
        void refreshPendingWikiShareInvitesBadge()
      })

    const onVisibilityForShares = () => {
      if (document.visibilityState === 'visible') void refreshPendingWikiShareInvitesBadge()
    }
    document.addEventListener('visibilitychange', onVisibilityForShares)

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
      document.removeEventListener('visibilitychange', onVisibilityForShares)
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
        void refreshPendingWikiShareInvitesBadge()
      } else if (e.type === 'wiki-shares-changed') {
        void refreshPendingWikiShareInvitesBadge()
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
    const shareOpts = wikiShareOptsFromRoute()
    const overlay: Overlay = path ? { type: 'wiki', path, ...shareOpts } : { type: 'wiki-dir', ...shareOpts }
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

  /** Open a wiki document from a **unified** path (`@handle/…`, `me/…`, or vault-relative). Mirrors `wikis/` layout in the overlay URL. */
  function openWikiDoc(unifiedPath?: string) {
    const p = unifiedPath?.trim() ?? ''
    const overlay: Overlay = p.length > 0 ? { type: 'wiki', path: p } : { type: 'wiki' }
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
    if (p.length > 0) {
      void addToNavHistory({
        id: makeNavHistoryId('doc', p),
        type: 'doc',
        title: p,
        path: p,
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
    const extra = wikiShareOptsFromRoute()
    const sh =
      parsed.shareHandle?.trim().replace(/^@+/, '') ||
      extra.shareHandle?.trim().replace(/^@+/, '') ||
      undefined
    const vault = parsed.vaultRelPath.trim()
    const unified =
      m.startsWith('@') || m.startsWith('me/')
        ? m
        : sh && vault.length > 0
          ? `@${sh}/${vault}`
          : vault.length > 0
            ? vault
            : m
    const overlay: Overlay = {
      type: 'wiki',
      path: unified,
      ...(!m.startsWith('@') &&
      !sh &&
      (extra.shareOwner?.trim() || extra.sharePrefix?.trim())
        ? { shareOwner: extra.shareOwner, sharePrefix: extra.sharePrefix }
        : {}),
    }
    if (shell.route.wikiActive) {
      const replace = shouldReplaceWikiOverlay(shell.route)
      navigateShell({ wikiActive: true, overlay }, replace ? { replace: true } : undefined)
      shell.route = parseRoute()
      return
    }
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

  function overlayForWikiDirNavigate(trimmed: string | undefined): Overlay {
    const t = trimmed?.trim()
    if (!t) return { type: 'wiki-dir' }
    if (t === 'me' || t === 'my-wiki' || t === MY_WIKI_SEGMENT) {
      return { type: 'wiki-dir', path: 'me' }
    }
    const parsed = parseUnifiedWikiBrowsePath(t)
    if (parsed.shareHandle) {
      const ownerDir = parsed.vaultRelPath.replace(/\/+$/, '') || undefined
      return {
        type: 'wiki-dir',
        ...(ownerDir ? { path: ownerDir } : {}),
        shareHandle: parsed.shareHandle,
      }
    }
    let path = parsed.vaultRelPath.replace(/\/+$/, '') || undefined
    if (path === 'my-wiki' || path === MY_WIKI_SEGMENT) path = 'me'
    return path ? { type: 'wiki-dir', path } : { type: 'wiki-dir' }
  }

  function openWikiDir(dirPath?: string) {
    const o = shell.route.overlay
    const parent = o?.type === 'wiki-dir' ? o : null
    const merged = mergeWikiBrowseChildPath(parent, dirPath) ?? dirPath
    const overlay = overlayForWikiDirNavigate(merged)
    if (shell.route.wikiActive) {
      const replace = shouldReplaceWikiOverlay(shell.route)
      navigateShell({ wikiActive: true, overlay }, replace ? { replace: true } : undefined)
      shell.route = parseRoute()
      return
    }
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

  function openIndexedFileDoc(id: string, source?: string) {
    const overlay: Overlay = {
      type: 'indexed-file',
      id,
      ...(source?.trim() ? { source: source.trim() } : {}),
    }
    const flags = routeSurfaceFlagsForOverlay(overlay)
    navigateShell({
      wikiActive: false,
      overlay,
      hubActive: flags.hubActive,
      settingsActive: flags.settingsActive,
      ...(flags.useChatSession ? chatSessionPart() : {}),
    })
    shell.route = parseRoute()
    shell.agentContext = {
      type: 'indexed-file',
      id,
      title: '(loading)',
      sourceKind: '',
      ...(source?.trim() ? { source: source.trim() } : {}),
    }
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

  /** Empty-state "your wiki" → same help as Hub (`HubWikiAboutPanel` in SlideOver / mobile stack). */
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
    void refreshPendingWikiShareInvitesBadge()
  }

  async function refreshPendingWikiShareInvitesBadge() {
    try {
      const data = await fetchWikiSharesList()
      shell.pendingWikiShareInvitesCount = data?.pendingReceived?.length ?? 0
    } catch {
      /* ignore — optional badge; dev/test fetch may be unmocked or offline */
    }
  }

  function onNavigateToSharedWikiFromHub(p: {
    ownerId: string
    ownerHandle: string
    pathPrefix: string
    targetKind: 'dir' | 'file'
  }) {
    if (p.targetKind === 'file') {
      openSharedWikiFile({ ownerId: p.ownerId, filePath: p.pathPrefix, ownerHandle: p.ownerHandle })
    } else {
      openSharedWiki({ ownerId: p.ownerId, pathPrefix: p.pathPrefix, ownerHandle: p.ownerHandle })
    }
    shell.route = parseRoute()
    void refreshPendingWikiShareInvitesBadge()
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

  /** Shared icon-button recipe for the wiki primary bar (Edit / Save / Share). */
  const wikiPrimaryIconBtn =
    'wiki-primary-icon-btn inline-flex items-center justify-center p-1.5 border-0 rounded-md bg-transparent text-muted cursor-pointer transition-colors enabled:hover:text-accent enabled:hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] disabled:opacity-45 disabled:cursor-not-allowed'
</script>

{#if shell.showSearch}
  <Search
    onOpenWiki={(path) => { openWikiDoc(path); shell.showSearch = false }}
    onWikiHome={navigateWikiPrimary}
    onOpenEmail={(id, subject, from) => { openEmailFromSearch(id, subject, from); shell.showSearch = false }}
    onClose={() => shell.showSearch = false}
  />
{/if}

<div class="app flex h-full flex-col">
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
    shareInviteBadge={shell.pendingWikiShareInvitesCount > 0}
    onOpenSettings={openSettings}
  />

  <div class="app-main-row relative flex min-h-0 flex-1">
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

    <div class="workspace-column flex min-h-0 min-w-0 flex-1 flex-col" bind:clientWidth={shell.workspaceColumnWidth}>
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
          {:else if shell.route.wikiActive && shell.route.overlay && (shell.route.overlay.type === 'wiki' || shell.route.overlay.type === 'wiki-dir')}
            <div class="hub-container relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <WikiPrimaryShell bind:wikiHdrRef={wikiPrimaryHdr}>
                {#snippet bar()}
                  <div class="wiki-primary-bar flex shrink-0 items-center justify-between gap-2.5 border-b border-border bg-surface-2 px-2.5 py-1.5">
                    <nav class="wiki-primary-crumbs flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-[13px] font-medium text-muted" aria-label="Wiki location">
                      {#each wikiPrimaryBarCrumbs as crumb, i (i)}
                        {#if i > 0}<span class="wiki-primary-crumb-sep shrink-0 select-none opacity-45" aria-hidden="true">/</span>{/if}
                        {#if crumb.kind === 'wiki-root-link'}
                          <button
                            type="button"
                            class="wiki-primary-crumb-btn -mx-0.5 -my-1 max-w-full shrink-0 cursor-pointer border-0 bg-transparent px-0.5 py-1 font-medium text-accent underline underline-offset-2 hover:text-foreground"
                            onclick={() => openWikiDir(undefined)}
                          >Wiki</button>
                        {:else if crumb.kind === 'folder-link'}
                          <button
                            type="button"
                            class="wiki-primary-crumb-btn -mx-0.5 -my-1 max-w-full shrink-0 cursor-pointer border-0 bg-transparent px-0.5 py-1 font-medium text-accent underline underline-offset-2 hover:text-foreground"
                            onclick={() => openWikiDir(crumb.path)}
                          >{crumb.label}</button>
                        {:else}
                          <span class="wiki-primary-crumb-current min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-foreground">{crumb.label}</span>
                        {/if}
                      {/each}
                    </nav>
                    <div class="wiki-primary-actions flex shrink-0 items-center gap-2" role="toolbar" aria-label="Wiki actions">
                      {#if wikiPrimaryHdr?.current?.sharedIncoming}
                        <span class="wiki-primary-pill text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-3,var(--text-2))]">Read-only</span>
                      {/if}
                      {#if wikiPrimaryHdr?.current?.canShare && wikiPrimaryHdr.current.onOpenShare}
                        <button
                          type="button"
                          class={cn(wikiPrimaryIconBtn, 'wiki-share-header-btn')}
                          onclick={() => wikiPrimaryHdr?.current?.onOpenShare?.()}
                          title={wikiPrimaryShareTitle(wikiPrimaryHdr.current)}
                          aria-label={wikiPrimaryShareAria(wikiPrimaryHdr.current)}
                        >
                          <span class="wiki-share-header-inner relative inline-flex items-center justify-center">
                            <Share2 size={17} strokeWidth={2} aria-hidden="true" />
                            {#if (wikiPrimaryHdr.current.shareAudienceCount ?? 0) > 0}
                              <span class="wiki-share-header-badge absolute -top-1 -right-2 box-border inline-block min-w-[16px] h-4 rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-[var(--bg-pill-on-accent,var(--bg,#fff))] [font-variant-numeric:tabular-nums]" aria-hidden="true">
                                {wikiShareAudienceBadgePrimary(wikiPrimaryHdr.current.shareAudienceCount)}
                              </span>
                            {/if}
                          </span>
                        </button>
                      {/if}
                      {#if shell.route.overlay.type === 'wiki' && wikiPrimaryHdr?.current}
                        {#if wikiPrimaryHdr.current.saveState === 'saving'}
                          <span class="wiki-save-hint text-xs font-semibold text-accent" role="status">Saving…</span>
                        {:else if wikiPrimaryHdr.current.saveState === 'saved'}
                          <span class="wiki-save-hint text-xs font-semibold text-accent" role="status">Saved</span>
                        {:else if wikiPrimaryHdr.current.saveState === 'error'}
                          <span class="wiki-save-hint wiki-save-err text-xs font-semibold text-[var(--text-3,var(--text-2))]" role="status">Save failed</span>
                        {/if}
                        <button
                          type="button"
                          class={cn(
                            'wiki-edit-btn',
                            wikiPrimaryIconBtn,
                            wikiPrimaryHdr.current.pageMode === 'edit' && 'active enabled:text-accent',
                          )}
                          disabled={!wikiPrimaryHdr.current.canEdit}
                          onclick={() =>
                            wikiPrimaryHdr?.current?.setPageMode(
                              wikiPrimaryHdr.current.pageMode === 'edit' ? 'view' : 'edit',
                            )}
                          title={wikiPrimaryHdr.current.pageMode === 'edit' ? 'View' : 'Edit'}
                          aria-label={wikiPrimaryHdr.current.pageMode === 'edit' ? 'Switch to view mode' : 'Switch to edit mode'}
                        >
                          {#if wikiPrimaryHdr.current.pageMode === 'edit'}
                            <Save size={15} strokeWidth={2} aria-hidden="true" />
                          {:else}
                            <Pencil size={15} strokeWidth={2} aria-hidden="true" />
                          {/if}
                        </button>
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
                          shareOwner={shell.route.overlay.shareOwner}
                          sharePrefix={shell.route.overlay.sharePrefix}
                          shareHandle={shell.route.overlay.shareHandle}
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
                          shareOwner={shell.route.overlay.shareOwner}
                          sharePrefix={shell.route.overlay.sharePrefix}
                          shareHandle={shell.route.overlay.shareHandle}
                          refreshKey={shell.wikiRefreshKey}
                          onOpenFile={(path) => onWikiNavigate(path)}
                          onOpenDir={(path) => openWikiDir(path)}
                          onOpenSharedDir={(p) =>
                            openSharedWiki({
                              ownerId: p.ownerId,
                              pathPrefix: p.sharePrefix,
                              ownerHandle: p.ownerHandle,
                            })}
                          onOpenSharedFile={(p) =>
                            openSharedWikiFile({
                              ownerId: p.ownerId,
                              filePath: p.sharePrefix,
                              ownerHandle: p.ownerHandle,
                            })}
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
          {:else if shell.route.hubActive || shell.route.overlay?.type === 'hub'}
            <div class="hub-container relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div class="hub-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                <BrainHubPage
                  onHubNavigate={navigateFromHub}
                  onOpenSettings={openSettings}
                  onNavigateToSharedWiki={onNavigateToSharedWikiFromHub}
                />
              </div>
              {#if
                !useDesktopSplitDetail &&
                shell.route.overlay &&
                shell.route.overlay.type !== 'hub' &&
                shell.route.overlay.type !== 'chat-history'
              }
                <div class="mobile-detail-layer absolute inset-0 z-10 flex min-h-0 flex-col [&_:global(.slide-over)]:flex-1 [&_:global(.slide-over)]:min-h-0 [&_:global(.slide-over)]:border-l-0">
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
                    onOpenSharedWiki={openSharedWiki}
                    onOpenSharedWikiFile={openSharedWikiFile}
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
                  />
                </div>
              {/if}
            </div>
          {:else if shell.route.settingsActive}
            <div class="hub-container relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div class="hub-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                <BrainSettingsPage
                  onSettingsNavigate={navigateFromSettings}
                  selectedHubSourceId={shell.route.overlay?.type === 'hub-source'
                    ? shell.route.overlay.id
                    : undefined}
                />
              </div>
              {#if
                !useDesktopSplitDetail &&
                shell.route.overlay &&
                shell.route.overlay.type !== 'hub' &&
                shell.route.overlay.type !== 'chat-history'
              }
                <div class="mobile-detail-layer absolute inset-0 z-10 flex min-h-0 flex-col [&_:global(.slide-over)]:flex-1 [&_:global(.slide-over)]:min-h-0 [&_:global(.slide-over)]:border-l-0">
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
                    onOpenSharedWiki={openSharedWiki}
                    onOpenSharedWikiFile={openSharedWikiFile}
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
                    onOpenSharedWiki={openSharedWiki}
                    onOpenSharedWikiFile={openSharedWikiFile}
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
              onOpenSharedWiki={openSharedWiki}
              onOpenSharedWikiFile={openSharedWikiFile}
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
  </div>
</div>
