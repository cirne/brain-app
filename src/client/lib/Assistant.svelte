<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fly, slide } from 'svelte/transition'
  import Search from './Search.svelte'
  import AppTopNav from './AppTopNav.svelte'
  import BrainHubPage from './BrainHubPage.svelte'
  import SlideOver from './SlideOver.svelte'
  import AgentChat from './AgentChat.svelte'
  import ChatHistory from './ChatHistory.svelte'
  import WorkspaceSplit from './WorkspaceSplit.svelte'
  import {
    parseRoute,
    navigate,
    type Route,
    type SurfaceContext,
    type Overlay,
    type NavigateOptions,
  } from '../router.js'
  import { applyHubDetailNavigation } from './hubShellNavigate.js'
  import { runParallelSyncs } from './app/syncAllServices.js'
  import { matchGlobalShortcut } from './app/globalShortcuts.js'
  import { emit, subscribe } from './app/appEvents.js'
  import { startHubEventsConnection } from './hubEvents/hubEventsClient.js'
  import {
    cancelPendingDebouncedWikiSync,
    onWikiMutatedForAutoSync,
    registerDebouncedWikiSyncRunner,
    runSyncOrQueueFollowUp,
  } from './app/debouncedWikiSync.js'
  import { wikiPathForReadToolArg } from './cards/contentCards.js'
  import { navigateFromAgentOpen, type AgentOpenSource } from './navigateFromAgentOpen.js'
  import { WORKSPACE_DESKTOP_SPLIT_MIN_PX } from './app/workspaceLayout.js'
  import { fetchVaultStatus } from './vaultClient.js'
  import { addToNavHistory, makeNavHistoryId, upsertEmailNavHistory } from './navHistory.js'

  function loadSidebarPrefs(): { sidebarOpen?: boolean } {
    return {}
  }

  let route = $state<Route>(parseRoute())
  let syncErrors = $state<string[]>([])
  let showSyncErrors = $state(false)
  let calendarRefreshKey = $state(0)
  let wikiRefreshKey = $state(0)
  let showSearch = $state(false)
  let inboxTargetId = $state<string | undefined>()
  /** Live markdown while the agent streams a `write` tool — wiki pane only. */
  let wikiWriteStreaming = $state<{ path: string; body: string } | null>(null)
  /** Live `edit` tool — wiki pane shows “Editing…” until tool_end. */
  let wikiEditStreaming = $state<{ path: string; toolId: string } | null>(null)
  let agentChat = $state<AgentChat | undefined>()
  let chatIsEmpty = $state(true)
  let mobileSlideOver = $state<{ closeAnimated: () => void } | undefined>()
  let workspaceSplit = $state<WorkspaceSplit | undefined>()
  /** Desktop: detail pane fills workspace when true (WorkspaceSplit + SlideOver header). */
  let detailPaneFullscreen = $state(false)
  let isMobile = $state(false)
  /** Width of `.workspace-column` — drives split vs slide-over together with `isMobile`. */
  let workspaceColumnWidth = $state(0)
  /**
   * Desktop side-by-side chat + detail (vs slide-over). Uses measured workspace width so an open
   * history rail does not force two narrow columns on a wide window.
   */
  const useDesktopSplitDetail = $derived(
    !isMobile && workspaceColumnWidth >= WORKSPACE_DESKTOP_SPLIT_MIN_PX,
  )
  const slideOverCloseAnimated = $derived(!useDesktopSplitDetail && mobileSlideOver)

  /** Hosted nav pill: `@handle` after onboarding confirmation (from vault status). */
  let hostedHandleNav = $state<string | undefined>(undefined)

  /** History sidebar open (desktop inline or mobile overlay). */
  let sidebarOpen = $state(false)
  let chatHistory = $state<{ refresh: (_opts?: { background?: boolean }) => Promise<void> } | undefined>()
  let activeSessionId = $state<string | null>(null)
  /** Server session ids with an in-flight agent stream (sidebar “working” icon), including background chats. */
  let streamingSessionIds = $state<ReadonlySet<string>>(new Set())

  const SIDEBAR_FLY_X = 280
  const SIDEBAR_TRANSITION_MS = 220

  /** Instant open/close when user prefers reduced motion. */
  let reduceSidebarMotion = $state(false)

  /**
   * Mobile: drawer over content (transform slide).
   * Desktop: width animation so flex reflows with the rail as it opens/closes.
   */
  function historySidebarTransition(
    node: Element,
    { mobile, reduce }: { mobile: boolean; reduce: boolean }
  ) {
    if (mobile) {
      return fly(node, {
        x: reduce ? 0 : -SIDEBAR_FLY_X,
        duration: reduce ? 0 : SIDEBAR_TRANSITION_MS,
      })
    }
    return slide(node, {
      axis: 'x',
      duration: reduce ? 0 : SIDEBAR_TRANSITION_MS,
    })
  }

  let agentContext = $state<SurfaceContext>({ type: 'chat' })

  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const syncMobile = () => { isMobile = mq.matches }
    syncMobile()

    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncReduce = () => { reduceSidebarMotion = mqReduce.matches }
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
          hostedHandleNav = v.workspaceHandle
        } else {
          hostedHandleNav = undefined
        }
      })
      .catch(() => {
        hostedHandleNav = undefined
      })

    const prefs = loadSidebarPrefs()
    if (mq.matches) {
      sidebarOpen = prefs.sidebarOpen ?? false
    } else {
      sidebarOpen = prefs.sidebarOpen ?? true
    }

    route = parseRoute()

    const onPopState = () => {
      route = parseRoute()
    }
    window.addEventListener('popstate', onPopState)
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && route.overlay) {
        e.preventDefault()
        if (slideOverCloseAnimated) slideOverCloseAnimated.closeAnimated()
        else closeOverlay()
        return
      }
      if (e.key === 'Escape' && sidebarOpen) {
        e.preventDefault()
        sidebarOpen = false
        return
      }
      const action = matchGlobalShortcut(e)
      if (!action) return
      e.preventDefault()
      switch (action.type) {
        case 'search':
          showSearch = true
          break
        case 'newChat':
          historyNewChat()
          break
        case 'refresh':
          void syncAll()
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
      for (let i = 0; i < 16; i++) {
        await tick()
        if (agentChat) {
          try {
            agentChat.newChat()
            await tick()
            await agentChat.sendFirstChatKickoff()
          } catch {
            /* ignore */
          }
          return
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
        wikiRefreshKey++
        onWikiMutatedForAutoSync()
      } else if (e.type === 'sync:completed') {
        calendarRefreshKey++
        wikiRefreshKey++
      }
    })
  })

  function closeOverlayImmediate() {
    navigate({ hubActive: route.hubActive }, { replace: true })
    route = parseRoute()
    agentContext = { type: 'chat' }
    inboxTargetId = undefined
    wikiWriteStreaming = null
    wikiEditStreaming = null
  }

  function closeOverlay() {
    if (!route.overlay) return
    if (useDesktopSplitDetail) {
      workspaceSplit?.closeDesktopAnimated()
      return
    }
    closeOverlayImmediate()
  }

  /** Slide-over layout: dismiss overlay after send so the transcript is visible. */
  function closeOverlayOnUserSend() {
    chatIsEmpty = false
    if (!useDesktopSplitDetail && route.overlay) {
      closeOverlayImmediate()
    }
  }

  function wikiOverlayReplace(): boolean {
    const t = route.overlay?.type
    return t === 'wiki' || t === 'wiki-dir'
  }

  function openWikiDoc(path?: string) {
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    const replace = wikiOverlayReplace()
    const hubActive = route.hubActive || route.overlay?.type === 'hub'
    navigate({ overlay, hubActive }, replace ? { replace: true } : undefined)
    route = parseRoute()
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
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    const replace = wikiOverlayReplace()
    const hubActive = route.hubActive || route.overlay?.type === 'hub'
    navigate({ overlay, hubActive }, replace ? { replace: true } : undefined)
    route = parseRoute()
  }

  function openWikiDir(dirPath?: string) {
    const trimmed = dirPath?.trim()
    const overlay: Overlay = trimmed ? { type: 'wiki-dir', path: trimmed } : { type: 'wiki-dir' }
    const replace = wikiOverlayReplace()
    const hubActive = route.hubActive || route.overlay?.type === 'hub'
    navigate({ overlay, hubActive }, replace ? { replace: true } : undefined)
    route = parseRoute()
  }

  function openFileDoc(path: string) {
    const hubActive = route.hubActive || route.overlay?.type === 'hub'
    navigate({ overlay: { type: 'file', path }, hubActive })
    route = parseRoute()
    void addToNavHistory({
      id: makeNavHistoryId('doc', `file:${path}`),
      type: 'doc',
      title: path,
      path,
    })
  }

  function onInboxNavigateSlide(id: string | undefined) {
    const overlay: Overlay = id ? { type: 'email', id } : { type: 'email' }
    const hubActive = route.hubActive || route.overlay?.type === 'hub'
    navigate({ overlay, hubActive })
    route = parseRoute()
  }

  function switchToCalendar(date: string, eventId?: string) {
    const hubActive = route.hubActive || route.overlay?.type === 'hub'
    navigate({ overlay: { type: 'calendar', date, ...(eventId ? { eventId } : {}) }, hubActive })
    route = parseRoute()
    agentContext = { type: 'calendar', date, ...(eventId ? { eventId } : {}) }
  }

  function resetCalendarToToday() {
    const d = new Date()
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    switchToCalendar(ymd)
  }

  function setContext(ctx: SurfaceContext) {
    agentContext = ctx
    if (ctx.type === 'email' && ctx.threadId) {
      void upsertEmailNavHistory(ctx.threadId, ctx.subject, ctx.from)
    }
  }

  function onSummarizeInbox(message: string) {
    agentContext = { type: 'inbox' }
    void agentChat?.newChatWithMessage(message)
  }

  function openEmailFromSearch(id: string, subject: string, from: string) {
    inboxTargetId = id
    const hubActive = route.hubActive || route.overlay?.type === 'hub'
    navigate({ overlay: { type: 'email', id }, hubActive })
    route = parseRoute()
    agentContext = { type: 'email', threadId: id, subject, from }
    if (id && subject.trim()) {
      void upsertEmailNavHistory(id, subject, from)
    }
  }

  function openEmailFromChat(threadId: string, subject?: string, from?: string) {
    openEmailFromSearch(threadId, subject ?? '', from ?? '')
  }

  function openFullInboxFromChat() {
    inboxTargetId = undefined
    navigate({ overlay: { type: 'email' } })
    route = parseRoute()
  }

  function openMessageThreadFromChat(canonicalChat: string, displayLabel: string) {
    navigate({ overlay: { type: 'messages', chat: canonicalChat }, hubActive: route.hubActive })
    route = parseRoute()
    agentContext = { type: 'messages', chat: canonicalChat, displayLabel }
  }

  /** Brain Hub rows → same detail stack as chat (`SlideOver` + `Overlay`). */
  function navigateFromHub(overlay: Overlay, opts?: NavigateOptions) {
    applyHubDetailNavigation(route, overlay, opts)
    route = parseRoute()
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
    const o = route.overlay
    if (o?.type === 'messages' && o.chat) {
      if (agentContext.type !== 'messages' || agentContext.chat !== o.chat) {
        agentContext = { type: 'messages', chat: o.chat, displayLabel: '(loading)' }
      }
    }
  })

  /** LLM `open` / `read_doc` — navigate on tool_start. Mobile: only `open` opens the panel; `read_doc` stays preview-only. */
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
    syncErrors = []
    showSyncErrors = false
    try {
      syncErrors = await runParallelSyncs(fetch)
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

  $effect(() => {
    // No-op: localStorage persistence disabled.
  })

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen
    if (sidebarOpen) void chatHistory?.refresh()
  }

  async function selectChatSession(id: string) {
    closeOverlayImmediate()
    await agentChat?.loadSession(id)
    chatIsEmpty = false
    if (isMobile) sidebarOpen = false
  }

  function selectDocFromHistory(path: string) {
    openWikiDoc(path)
    if (isMobile) sidebarOpen = false
  }

  function selectEmailFromHistory(id: string) {
    openEmailFromSearch(id, '', '')
    if (isMobile) sidebarOpen = false
  }

  function historyNewChat() {
    closeOverlayImmediate()
    navigate({ hubActive: false })
    route = parseRoute()
    agentChat?.newChat()
    chatIsEmpty = true
    if (isMobile) sidebarOpen = false
  }

  /** Empty-state “your wiki” → same help as Hub (`HubWikiAboutPanel` in SlideOver / mobile stack). */
  function openHubWikiAbout() {
    navigate({
      overlay: { type: 'hub-wiki-about' },
      hubActive: route.hubActive === true,
    })
    route = parseRoute()
  }

  function onSessionChangeFromAgent(id: string | null) {
    activeSessionId = id
  }

  function onWriteStreaming(p: { path: string; content: string; done: boolean }) {
    if (p.done) {
      wikiWriteStreaming = null
      return
    }
    if (p.path) {
      wikiWriteStreaming = { path: p.path, body: p.content }
    }
  }

  function openHubToHandleSection() {
    navigate({ hubActive: true })
    route = parseRoute()
    void tick().then(() => {
      document.getElementById('hub-account-handle')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  function onEditStreaming(p: { id: string; path: string; done: boolean }) {
    if (p.done) {
      if (wikiEditStreaming?.toolId === p.id) wikiEditStreaming = null
      return
    }
    if (p.path) {
      wikiEditStreaming = { path: wikiPathForReadToolArg(p.path), toolId: p.id }
    }
  }

</script>

{#if showSearch}
  <Search
    onOpenWiki={(path) => { openWikiDoc(path); showSearch = false }}
    onOpenEmail={(id, subject, from) => { openEmailFromSearch(id, subject, from); showSearch = false }}
    onClose={() => showSearch = false}
  />
{/if}

<div class="app">
    <AppTopNav
    {isMobile}
    sidebarOpen={sidebarOpen}
    onToggleSidebar={toggleSidebar}
    {syncErrors}
    {showSyncErrors}
    onOpenSearch={() => { showSearch = true }}
    onToggleSyncErrors={() => { showSyncErrors = !showSyncErrors }}
    onOpenHub={() => {
      navigate({ hubActive: true })
      route = parseRoute()
    }}
    onNewChat={historyNewChat}
    isEmptyChat={chatIsEmpty}
    hostedHandlePill={hostedHandleNav}
    onHostedHandleNavigate={openHubToHandleSection}
  />

    <div class="app-main-row">
    {#if sidebarOpen}
      {#if isMobile}
        <div
          class="sidebar-backdrop"
          role="presentation"
          aria-hidden="true"
          onclick={() => { sidebarOpen = false }}
        ></div>
      {/if}
      <aside
        class="history-sidebar history-sidebar--slide"
        in:historySidebarTransition={{ mobile: isMobile, reduce: reduceSidebarMotion }}
        out:historySidebarTransition={{ mobile: isMobile, reduce: reduceSidebarMotion }}
      >
        <div class="rail-inner">
          <div class="rail-panel rail-panel--chat">
            <ChatHistory
              bind:this={chatHistory}
              activeSessionId={activeSessionId}
              streamingSessionIds={streamingSessionIds}
              onSelect={selectChatSession}
              onSelectDoc={selectDocFromHistory}
              onSelectEmail={selectEmailFromHistory}
              onNewChat={historyNewChat}
            />
          </div>
        </div>
      </aside>
    {/if}

    <div class="workspace-column" bind:clientWidth={workspaceColumnWidth}>
  <WorkspaceSplit
    bind:this={workspaceSplit}
    bind:detailFullscreen={detailPaneFullscreen}
    hasDetail={!!route.overlay && route.overlay.type !== 'hub'}
    desktopDetailOpen={!!route.overlay && route.overlay.type !== 'hub' && useDesktopSplitDetail}
    onNavigateClear={closeOverlayImmediate}
  >
    {#snippet chat()}
      {#if route.hubActive || route.overlay?.type === 'hub'}
        <div class="hub-container">
          <div class="hub-scroll">
            <BrainHubPage onHubNavigate={navigateFromHub} />
          </div>
          {#if !useDesktopSplitDetail && route.overlay && route.overlay.type !== 'hub'}
            <div class="mobile-detail-layer">
              <SlideOver
                bind:this={mobileSlideOver}
                overlay={route.overlay}
                surfaceContext={agentContext}
                wikiRefreshKey={wikiRefreshKey}
                calendarRefreshKey={calendarRefreshKey}
                inboxTargetId={inboxTargetId}
                wikiStreamingWrite={wikiWriteStreaming}
                wikiStreamingEdit={wikiEditStreaming}
                onWikiNavigate={onWikiNavigate}
                onWikiDirNavigate={openWikiDir}
                onInboxNavigate={onInboxNavigateSlide}
                onContextChange={setContext}
                onOpenSearch={() => { showSearch = true }}
                onSummarizeInbox={onSummarizeInbox}
                onCalendarResetToToday={resetCalendarToToday}
                onCalendarNavigate={switchToCalendar}
                toolOnOpenFile={openFileDoc}
                toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
                toolOnOpenFullInbox={openFullInboxFromChat}
                toolOnOpenMessageThread={openMessageThreadFromChat}
                onOpenWikiAbout={openHubWikiAbout}
                onClose={closeOverlay}
                mobilePanel
              />
            </div>
          {/if}
        </div>
      {:else}
        <AgentChat
          bind:this={agentChat}
          context={agentContext}
          conversationHidden={!!route.overlay && !useDesktopSplitDetail}
          hidePaneContextChip={!!route.overlay && useDesktopSplitDetail}
          suppressAgentDetailAutoOpen={!useDesktopSplitDetail}
          onOpenWiki={openWikiDoc}
          onOpenFile={openFileDoc}
          onOpenEmail={openEmailFromChat}
          onOpenFullInbox={openFullInboxFromChat}
          onOpenMessageThread={openMessageThreadFromChat}
          onSwitchToCalendar={switchToCalendar}
          onOpenFromAgent={onOpenFromAgent}
          onNewChat={closeOverlay}
          onOpenWikiAbout={openHubWikiAbout}
          onAfterDeleteChat={historyNewChat}
          onUserSendMessage={closeOverlayOnUserSend}
          onSessionChange={onSessionChangeFromAgent}
          onStreamingSessionsChange={(ids) => { streamingSessionIds = ids }}
          onWriteStreaming={onWriteStreaming}
          onEditStreaming={onEditStreaming}
        >
          {#snippet mobileDetail()}
            {#if route.overlay && route.overlay.type !== 'hub'}
              <SlideOver
                bind:this={mobileSlideOver}
                overlay={route.overlay}
                surfaceContext={agentContext}
                wikiRefreshKey={wikiRefreshKey}
                calendarRefreshKey={calendarRefreshKey}
                inboxTargetId={inboxTargetId}
                wikiStreamingWrite={wikiWriteStreaming}
                wikiStreamingEdit={wikiEditStreaming}
                onWikiNavigate={onWikiNavigate}
                onWikiDirNavigate={openWikiDir}
                onInboxNavigate={onInboxNavigateSlide}
                onContextChange={setContext}
                onOpenSearch={() => { showSearch = true }}
                onSummarizeInbox={onSummarizeInbox}
                onCalendarResetToToday={resetCalendarToToday}
                onCalendarNavigate={switchToCalendar}
                toolOnOpenFile={openFileDoc}
                toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
                toolOnOpenFullInbox={openFullInboxFromChat}
                toolOnOpenMessageThread={openMessageThreadFromChat}
                onOpenWikiAbout={openHubWikiAbout}
                onClose={closeOverlay}
                mobilePanel
              />
            {/if}
          {/snippet}
        </AgentChat>
      {/if}
    {/snippet}
    {#snippet desktopDetail()}
      {#if route.overlay && route.overlay.type !== 'hub'}
        <SlideOver
          overlay={route.overlay}
          surfaceContext={agentContext}
          wikiRefreshKey={wikiRefreshKey}
          calendarRefreshKey={calendarRefreshKey}
          inboxTargetId={inboxTargetId}
          wikiStreamingWrite={wikiWriteStreaming}
          wikiStreamingEdit={wikiEditStreaming}
          onWikiNavigate={onWikiNavigate}
          onWikiDirNavigate={openWikiDir}
          onInboxNavigate={onInboxNavigateSlide}
          onContextChange={setContext}
          onOpenSearch={() => { showSearch = true }}
          onSummarizeInbox={onSummarizeInbox}
          onCalendarResetToToday={resetCalendarToToday}
          onCalendarNavigate={switchToCalendar}
          toolOnOpenFile={openFileDoc}
          toolOnOpenEmail={(i, s, f) => openEmailFromSearch(i, s ?? '', f ?? '')}
          toolOnOpenFullInbox={openFullInboxFromChat}
          toolOnOpenMessageThread={openMessageThreadFromChat}
          onOpenWikiAbout={openHubWikiAbout}
          onClose={closeOverlay}
          detailFullscreen={detailPaneFullscreen}
          onToggleFullscreen={() => workspaceSplit?.toggleDetailFullscreen()}
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
      width: min(var(--sidebar-history-w), 92vw);
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
