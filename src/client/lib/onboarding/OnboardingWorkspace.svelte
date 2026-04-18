<script lang="ts">
  /**
   * Same assistant shell as the main app (WorkspaceSplit + AgentChat + SlideOver)
   * without chat history sidebar, so onboarding can open email/wiki/calendar while the agent runs.
   */
  import { onMount } from 'svelte'
  import { countSeedEligibleWikiPages } from './seedWikiPageCount.js'
  import Search from '../Search.svelte'
  import AppTopNav from '../AppTopNav.svelte'
  import SlideOver from '../SlideOver.svelte'
  import AgentChat from '../AgentChat.svelte'
  import AgentConversation from '../agent-conversation/AgentConversation.svelte'
  import OnboardingProfilingView from './OnboardingProfilingView.svelte'
  import WorkspaceSplit from '../WorkspaceSplit.svelte'
  import { parseRoute, navigate, type Route, type SurfaceContext, type Overlay } from '../../router.js'
  import { runParallelSyncs } from '../app/syncAllServices.js'
  import { emit, subscribe } from '../app/appEvents.js'
  import { matchGlobalShortcut } from '../app/globalShortcuts.js'
  import { wikiPathForReadToolArg } from '../cards/contentCards.js'
  import { navigateFromAgentOpen, type AgentOpenSource } from '../navigateFromAgentOpen.js'
  import { ONBOARDING_DEFAULT_CHAT_STORAGE_KEY } from './onboardingStorageKeys.js'

  const {
    chatEndpoint,
    autoSendMessage,
    onStreamFinished,
    /** Wiki activity for onboarding seed threshold + status bar (seeding endpoint only). */
    onSeedWikiActivity,
    headerFallbackTitle = 'Chat',
    storageKey = ONBOARDING_DEFAULT_CHAT_STORAGE_KEY,
    /** When true, agent tools never auto-open the right detail panel (desktop + mobile). Default: only suppress on mobile, like the main assistant. */
    suppressAgentDetailAutoOpen = false,
  }: {
    chatEndpoint: string
    autoSendMessage: string
    onStreamFinished?: () => void | Promise<void>
    onSeedWikiActivity?: (_info: { pageCount: number; lastDocPath: string | null }) => void
    headerFallbackTitle?: string
    storageKey?: string
    suppressAgentDetailAutoOpen?: boolean
  } = $props()

  const isSeedingWiki = $derived(chatEndpoint === '/api/onboarding/seed')
  const isProfiling = $derived(chatEndpoint === '/api/onboarding/profile')
  /** Profiling + seeding use the same activity transcript (not the default chat). */
  const useOnboardingActivity = $derived(isProfiling || isSeedingWiki)

  let route = $state<Route>(parseRoute())
  let syncing = $state(false)
  let syncErrors = $state<string[]>([])
  let showSyncErrors = $state(false)
  let calendarRefreshKey = $state(0)
  let wikiRefreshKey = $state(0)
  let showSearch = $state(false)
  let inboxTargetId = $state<string | undefined>()
  let wikiWriteStreaming = $state<{ path: string; body: string } | null>(null)
  let wikiEditStreaming = $state<{ path: string; toolId: string } | null>(null)
  let agentChat = $state<AgentChat | undefined>()
  let mobileSlideOver = $state<{ closeAnimated: () => void } | undefined>()
  let workspaceSplit = $state<WorkspaceSplit | undefined>()
  let detailPaneFullscreen = $state(false)
  let isMobile = $state(false)

  let agentContext = $state<SurfaceContext>({ type: 'chat' })

  async function refreshSeedWikiStatus() {
    if (!isSeedingWiki) return
    try {
      const [wikiRes, histRes] = await Promise.all([
        fetch('/api/wiki'),
        fetch('/api/wiki/edit-history?limit=1'),
      ])
      const files = (await wikiRes.json()) as { path?: string }[]
      const paths = Array.isArray(files) ? files.map((f) => f.path).filter((p): p is string => typeof p === 'string') : []
      const pageCount = countSeedEligibleWikiPages(paths)
      const hist = (await histRes.json()) as { files?: { path: string; date: string }[] }
      const lastDocPath = hist.files?.[0]?.path ?? null
      onSeedWikiActivity?.({ pageCount, lastDocPath })
    } catch { /* ignore */ }
  }

  async function handleWorkspaceStreamFinished() {
    await onStreamFinished?.()
  }

  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const syncMobile = () => { isMobile = mq.matches }
    syncMobile()
    mq.addEventListener('change', syncMobile)

    if (chatEndpoint === '/api/onboarding/seed') {
      void refreshSeedWikiStatus()
    }
    const onPopState = () => { route = parseRoute() }
    window.addEventListener('popstate', onPopState)
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && route.overlay) {
        e.preventDefault()
        if (isMobile && mobileSlideOver) mobileSlideOver.closeAnimated()
        else closeOverlay()
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
    return () => {
      mq.removeEventListener('change', syncMobile)
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onKeydown)
    }
  })

  function closeOverlayImmediate() {
    navigate({}, { replace: true })
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

  function closeOverlayOnUserSend() {
    if (isMobile && route.overlay) {
      closeOverlayImmediate()
    }
  }

  function openWikiDoc(path?: string) {
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    const replace = route.overlay?.type === 'wiki'
    navigate({ overlay }, replace ? { replace: true } : undefined)
    route = parseRoute()
  }

  function onWikiNavigate(path: string | undefined) {
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    const replace = route.overlay?.type === 'wiki'
    navigate({ overlay }, replace ? { replace: true } : undefined)
    route = parseRoute()
  }

  function openFileDoc(path: string) {
    navigate({ overlay: { type: 'file', path } })
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
    if (!isSeedingWiki) return
    const t = setInterval(() => {
      void refreshSeedWikiStatus()
    }, 1800)
    return () => clearInterval(t)
  })

  $effect(() => {
    return subscribe((e) => {
      if (e.type === 'wiki:mutated') {
        wikiRefreshKey++
        if (isSeedingWiki) void refreshSeedWikiStatus()
      } else if (e.type === 'sync:completed') {
        calendarRefreshKey++
        wikiRefreshKey++
      }
    })
  })

  $effect(() => {
    const o = route.overlay
    if (o?.type === 'messages' && o.chat) {
      if (agentContext.type !== 'messages' || agentContext.chat !== o.chat) {
        agentContext = { type: 'messages', chat: o.chat, displayLabel: '(loading)' }
      }
    }
  })

  function onOpenFromAgent(
    target: { type: string; path?: string; id?: string; date?: string },
    source: AgentOpenSource,
  ) {
    navigateFromAgentOpen(target, {
      source,
      isMobile,
      openWikiDoc: (path) => openWikiDoc(path),
      openFileDoc: (path) => openFileDoc(path),
      openEmailFromSearch,
      switchToCalendar,
    })
  }

  async function syncAll() {
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

  function noopSidebar() {
    /* chat history hidden in onboarding */
  }
</script>

{#if showSearch}
  <Search
    onOpenWiki={(path) => { openWikiDoc(path); showSearch = false }}
    onOpenEmail={(id, subject, from) => { openEmailFromSearch(id, subject, from); showSearch = false }}
    onClose={() => { showSearch = false }}
  />
{/if}

<div class="onboarding-workspace">
  <AppTopNav
    showChatHistoryButton={false}
    onToggleSidebar={noopSidebar}
    {syncing}
    {syncErrors}
    {showSyncErrors}
    onOpenSearch={() => { showSearch = true }}
    onSync={syncAll}
    onToggleSyncErrors={() => { showSyncErrors = !showSyncErrors }}
  />

  <div class="ob-ws-main">
    <WorkspaceSplit
      bind:this={workspaceSplit}
      bind:detailFullscreen={detailPaneFullscreen}
      hasDetail={!!route.overlay}
      desktopDetailOpen={!!route.overlay && !isMobile}
      onNavigateClear={closeOverlayImmediate}
    >
      {#snippet chat()}
        <AgentChat
          bind:this={agentChat}
          context={agentContext}
          conversationHidden={!!route.overlay && isMobile}
          suppressAgentDetailAutoOpen={suppressAgentDetailAutoOpen || isMobile || useOnboardingActivity}
          conversationView={useOnboardingActivity ? OnboardingProfilingView : AgentConversation}
          hideInput={useOnboardingActivity}
          streamingBusyLabel={
            useOnboardingActivity
              ? isProfiling
                ? 'Profiling…'
                : isSeedingWiki
                  ? 'Seeding wiki…'
                  : 'Working…'
              : 'Thinking...'
          }
          onboardingConversationKind={isProfiling ? 'profiling' : isSeedingWiki ? 'seeding' : undefined}
          {chatEndpoint}
          {autoSendMessage}
          streamingWritePreview={wikiWriteStreaming}
          {headerFallbackTitle}
          {storageKey}
          showNewChatButton={false}
          onStreamFinished={handleWorkspaceStreamFinished}
          onOpenWiki={openWikiDoc}
          onOpenFile={openFileDoc}
          onOpenEmail={openEmailFromChat}
          onOpenFullInbox={openFullInboxFromChat}
          onOpenMessageThread={openMessageThreadFromChat}
          onSwitchToCalendar={switchToCalendar}
          onOpenFromAgent={onOpenFromAgent}
          onNewChat={closeOverlay}
          onUserSendMessage={closeOverlayOnUserSend}
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
            detailFullscreen={detailPaneFullscreen}
            onToggleFullscreen={() => workspaceSplit?.toggleDetailFullscreen()}
          />
        {/if}
      {/snippet}
    </WorkspaceSplit>
  </div>

</div>

<style>
  .onboarding-workspace {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    height: 100%;
  }

  .ob-ws-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
</style>
