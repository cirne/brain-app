<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fly, slide } from 'svelte/transition'
  import Search from './Search.svelte'
  import AppTopNav from './AppTopNav.svelte'
  import SlideOver from './SlideOver.svelte'
  import AgentChat from './AgentChat.svelte'
  import ChatHistory from './ChatHistory.svelte'
  import WorkspaceSplit from './WorkspaceSplit.svelte'
  import { parseRoute, navigate, type Route, type SurfaceContext, type Overlay } from '../router.js'
  import { runParallelSyncs } from './app/syncAllServices.js'
  import { matchGlobalShortcut } from './app/globalShortcuts.js'
  import { emit, subscribe } from './app/appEvents.js'
  import {
    cancelPendingDebouncedWikiSync,
    onWikiMutatedForAutoSync,
    registerDebouncedWikiSyncRunner,
    runSyncOrQueueFollowUp,
  } from './app/debouncedWikiSync.js'
  import { wikiPathForReadToolArg } from './cards/contentCards.js'
  import { navigateFromAgentOpen, type AgentOpenSource } from './navigateFromAgentOpen.js'
  import { FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY } from './onboarding/seedConstants.js'
  import { addToNavHistory, makeNavHistoryId, upsertEmailNavHistory } from './navHistory.js'

  const SIDEBAR_KEY = 'brain-sidebar'

  function loadSidebarPrefs(): { sidebarOpen?: boolean } {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY)
      if (raw) {
        const o = JSON.parse(raw) as Record<string, unknown>
        if (typeof o.sidebarOpen === 'boolean') return { sidebarOpen: o.sidebarOpen }
        if (typeof o.mobileOpen === 'boolean') return { sidebarOpen: o.mobileOpen }
        if (typeof o.open === 'boolean') return { sidebarOpen: o.open }
      }
    } catch { /* ignore */ }
    return {}
  }

  let route = $state<Route>(parseRoute())
  let syncing = $state(false)
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
  let mobileSlideOver = $state<{ closeAnimated: () => void } | undefined>()
  let workspaceSplit = $state<WorkspaceSplit | undefined>()
  let isMobile = $state(false)

  /** History sidebar open (desktop inline or mobile overlay). */
  let sidebarOpen = $state(false)
  let chatHistory = $state<{ refresh: () => Promise<void> } | undefined>()
  let activeSessionId = $state<string | null>(null)
  /** True while the visible chat has an in-flight agent stream (for sidebar “working” icon). */
  let activeSessionStreaming = $state(false)

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

  let recentEditFiles = $state<{ path: string; date: string }[]>([])
  let dirtyFiles = $state<string[]>([])
  let showRecentFiles = $state(false)

  const recentFiles = $derived(recentEditFiles)

  async function loadWikiEditHistory() {
    try {
      const res = await fetch('/api/wiki/edit-history?limit=10')
      const data = await res.json()
      recentEditFiles = data.files ?? []
    } catch { /* ignore */ }
  }

  async function loadGitStatus() {
    try {
      const res = await fetch('/api/wiki/git-status')
      const data = await res.json()
      dirtyFiles = data.changedFiles ?? []
    } catch { /* ignore */ }
  }

  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const syncMobile = () => { isMobile = mq.matches }
    syncMobile()

    const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncReduce = () => { reduceSidebarMotion = mqReduce.matches }
    syncReduce()
    mqReduce.addEventListener('change', syncReduce)

    const prefs = loadSidebarPrefs()
    if (mq.matches) {
      sidebarOpen = prefs.sidebarOpen ?? false
    } else {
      sidebarOpen = prefs.sidebarOpen ?? true
    }

    loadWikiEditHistory()
    loadGitStatus()
    const onPopState = () => { route = parseRoute() }
    window.addEventListener('popstate', onPopState)
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && route.overlay) {
        e.preventDefault()
        if (isMobile && mobileSlideOver) mobileSlideOver.closeAnimated()
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
          closeOverlayImmediate()
          agentChat?.newChat()
          break
        case 'refresh':
          void syncAll()
          break
      }
    }
    window.addEventListener('keydown', onKeydown)

    void (async () => {
      try {
        if (sessionStorage.getItem(FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY) !== '1') return
      } catch {
        return
      }
      for (let i = 0; i < 16; i++) {
        await tick()
        if (agentChat) {
          try {
            sessionStorage.removeItem(FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY)
            agentChat.newChat()
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

    return () => {
      mq.removeEventListener('change', onMqChange)
      mqReduce.removeEventListener('change', syncReduce)
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onKeydown)
    }
  })

  $effect(() => {
    return subscribe((e) => {
      if (e.type === 'wiki:mutated') {
        void loadWikiEditHistory()
        void loadGitStatus()
        wikiRefreshKey++
        onWikiMutatedForAutoSync()
      } else if (e.type === 'sync:completed') {
        calendarRefreshKey++
        wikiRefreshKey++
        void loadWikiEditHistory()
        void loadGitStatus()
      }
    })
  })

  function closeOverlayImmediate() {
    navigate({})
    route = parseRoute()
    agentContext = { type: 'chat' }
    inboxTargetId = undefined
    wikiWriteStreaming = null
    wikiEditStreaming = null
  }

  function closeOverlay() {
    if (!route.overlay) return
    if (isMobile) {
      closeOverlayImmediate()
      return
    }
    workspaceSplit?.closeDesktopAnimated()
  }

  /** Mobile: dismiss docs/email/calendar overlay so the chat transcript is visible after send. */
  function closeOverlayOnUserSend() {
    if (isMobile && route.overlay) {
      closeOverlayImmediate()
    }
  }

  function openWikiDoc(path?: string) {
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    navigate({ overlay })
    route = parseRoute()
    if (path) {
      addToNavHistory({
        id: makeNavHistoryId('doc', path),
        type: 'doc',
        title: path,
        path,
      })
    }
  }

  function onWikiNavigate(path: string | undefined) {
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    navigate({ overlay })
    route = parseRoute()
  }

  function onInboxNavigateSlide(id: string | undefined) {
    const overlay: Overlay = id ? { type: 'email', id } : { type: 'email' }
    navigate({ overlay })
    route = parseRoute()
  }

  function switchToCalendar(date: string, eventId?: string) {
    navigate({ overlay: { type: 'calendar', date, ...(eventId ? { eventId } : {}) } })
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
      if (upsertEmailNavHistory(ctx.threadId, ctx.subject, ctx.from)) {
        void chatHistory?.refresh()
      }
    }
  }

  function onSummarizeInbox(message: string) {
    agentContext = { type: 'inbox' }
    void agentChat?.newChatWithMessage(message)
  }

  function openEmailFromSearch(id: string, subject: string, from: string) {
    inboxTargetId = id
    navigate({ overlay: { type: 'email', id } })
    route = parseRoute()
    agentContext = { type: 'email', threadId: id, subject, from }
    if (id && subject.trim()) {
      if (upsertEmailNavHistory(id, subject, from)) void chatHistory?.refresh()
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
    navigate({ overlay: { type: 'messages', chat: canonicalChat } })
    route = parseRoute()
    agentContext = { type: 'messages', chat: canonicalChat, displayLabel }
  }

  $effect(() => {
    const o = route.overlay
    if (o?.type === 'messages' && o.chat) {
      if (agentContext.type !== 'messages' || agentContext.chat !== o.chat) {
        agentContext = { type: 'messages', chat: o.chat, displayLabel: '(loading)' }
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
      isMobile,
      openWikiDoc: (path) => openWikiDoc(path),
      openEmailFromSearch,
      switchToCalendar,
    })
  }

  async function performFullSync(): Promise<void> {
    syncing = true
    syncErrors = []
    showSyncErrors = false
    try {
      syncErrors = await runParallelSyncs(fetch)
      emit({ type: 'sync:completed' })
    } finally {
      syncing = false
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
    try {
      localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ sidebarOpen }))
    } catch { /* ignore */ }
  })

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen
    if (sidebarOpen) void chatHistory?.refresh()
  }

  async function selectChatSession(id: string) {
    closeOverlayImmediate()
    await agentChat?.loadSession(id)
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
    agentChat?.newChat()
    if (isMobile) sidebarOpen = false
  }

  function onSessionChangeFromAgent(id: string | null) {
    activeSessionId = id
  }

  function onChatPersisted() {
    void chatHistory?.refresh()
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

  function onEditStreaming(p: { id: string; path: string; done: boolean }) {
    if (p.done) {
      if (wikiEditStreaming?.toolId === p.id) wikiEditStreaming = null
      return
    }
    if (p.path) {
      wikiEditStreaming = { path: wikiPathForReadToolArg(p.path), toolId: p.id }
    }
  }

  async function reRunOnboarding() {
    try {
      await fetch('/api/onboarding/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      })
    } catch {
      /* ignore */
    }
    window.location.href = '/onboarding'
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
    {dirtyFiles}
    {recentFiles}
    {showRecentFiles}
    {syncing}
    {syncErrors}
    {showSyncErrors}
    onOpenSearch={() => { showSearch = true }}
    onToggleRecentFiles={() => { showRecentFiles = !showRecentFiles }}
    onOpenWikiFromList={(path) => { openWikiDoc(path); showRecentFiles = false }}
    onSync={syncAll}
    onToggleSyncErrors={() => { showSyncErrors = !showSyncErrors }}
    onReRunOnboarding={reRunOnboarding}
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
        <ChatHistory
          bind:this={chatHistory}
          activeSessionId={activeSessionId}
          activeSessionStreaming={activeSessionStreaming}
          onSelect={selectChatSession}
          onSelectDoc={selectDocFromHistory}
          onSelectEmail={selectEmailFromHistory}
          onNewChat={historyNewChat}
        />
      </aside>
    {/if}

    <div class="workspace-column">
  <WorkspaceSplit
    bind:this={workspaceSplit}
    hasDetail={!!route.overlay}
    desktopDetailOpen={!!route.overlay && !isMobile}
    onNavigateClear={closeOverlayImmediate}
  >
    {#snippet chat()}
      <AgentChat
        bind:this={agentChat}
        context={agentContext}
        conversationHidden={!!route.overlay && isMobile}
        suppressAgentDetailAutoOpen={isMobile}
        onOpenWiki={openWikiDoc}
        onOpenEmail={openEmailFromChat}
        onOpenFullInbox={openFullInboxFromChat}
        onOpenMessageThread={openMessageThreadFromChat}
        onSwitchToCalendar={switchToCalendar}
        onOpenFromAgent={onOpenFromAgent}
        onNewChat={closeOverlay}
        onUserSendMessage={closeOverlayOnUserSend}
        onSessionChange={onSessionChangeFromAgent}
        onStreamingChange={(s) => { activeSessionStreaming = s }}
        onChatPersisted={onChatPersisted}
        onWriteStreaming={onWriteStreaming}
        onEditStreaming={onEditStreaming}
      >
        {#snippet mobileDetail()}
          {#if route.overlay}
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
              onInboxNavigate={onInboxNavigateSlide}
              onContextChange={setContext}
              onOpenSearch={() => { showSearch = true }}
              onSummarizeInbox={onSummarizeInbox}
              onCalendarResetToToday={resetCalendarToToday}
              onCalendarNavigate={switchToCalendar}
              onClose={closeOverlay}
              onSync={syncAll}
              {syncing}
              mobilePanel
            />
          {/if}
        {/snippet}
      </AgentChat>
    {/snippet}
    {#snippet desktopDetail()}
      {#if route.overlay}
        <SlideOver
          overlay={route.overlay}
          surfaceContext={agentContext}
          wikiRefreshKey={wikiRefreshKey}
          calendarRefreshKey={calendarRefreshKey}
          inboxTargetId={inboxTargetId}
          wikiStreamingWrite={wikiWriteStreaming}
          wikiStreamingEdit={wikiEditStreaming}
          onWikiNavigate={onWikiNavigate}
          onInboxNavigate={onInboxNavigateSlide}
          onContextChange={setContext}
          onOpenSearch={() => { showSearch = true }}
          onSummarizeInbox={onSummarizeInbox}
          onCalendarResetToToday={resetCalendarToToday}
          onCalendarNavigate={switchToCalendar}
          onClose={closeOverlay}
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

  .history-sidebar {
    min-height: 0;
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
