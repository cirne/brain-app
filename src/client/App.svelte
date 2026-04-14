<script lang="ts">
  import { onMount } from 'svelte'
  import Search from './lib/Search.svelte'
  import AppTopNav from './lib/AppTopNav.svelte'
  import SlideOver from './lib/SlideOver.svelte'
  import AgentDrawer from './lib/AgentDrawer.svelte'
  import { parseRoute, navigate, type Route, type SurfaceContext, type Overlay } from './router.js'
  import {
    AGENT_PANEL_WIDTH_KEY,
    DEFAULT_AGENT_PANEL_WIDTH,
    clampAgentPanelWidth,
    nextPanelWidthAfterDrag,
  } from './lib/app/agentPanelWidth.js'
  import { runParallelSyncs } from './lib/app/syncAllServices.js'
  import { matchGlobalShortcut } from './lib/app/globalShortcuts.js'
  import { emit, subscribe } from './lib/app/appEvents.js'
  import {
    cancelPendingDebouncedWikiSync,
    onWikiMutatedForAutoSync,
    registerDebouncedWikiSyncRunner,
    runSyncOrQueueFollowUp,
  } from './lib/app/debouncedWikiSync.js'

  let route = $state<Route>(parseRoute())
  let syncing = $state(false)
  let syncErrors = $state<string[]>([])
  let showSyncErrors = $state(false)
  let calendarRefreshKey = $state(0)
  let wikiRefreshKey = $state(0)
  let detailPanelWidth = $state(DEFAULT_AGENT_PANEL_WIDTH)
  let detailPanelResizing = $state(false)
  let showSearch = $state(false)
  let inboxTargetId = $state<string | undefined>()
  let agentDrawer = $state<AgentDrawer | undefined>()
  let isMobile = $state(false)

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
    try {
      const raw = localStorage.getItem(AGENT_PANEL_WIDTH_KEY)
      if (raw) {
        const n = parseInt(raw, 10)
        if (!Number.isNaN(n)) detailPanelWidth = clampAgentPanelWidth(n, window.innerWidth)
      }
    } catch { /* ignore */ }

    const mq = window.matchMedia('(max-width: 767px)')
    const syncMobile = () => { isMobile = mq.matches }
    syncMobile()
    mq.addEventListener('change', syncMobile)

    loadWikiEditHistory()
    loadGitStatus()
    const onPopState = () => { route = parseRoute() }
    window.addEventListener('popstate', onPopState)
    const onWinResize = () => {
      detailPanelWidth = clampAgentPanelWidth(detailPanelWidth, window.innerWidth)
    }
    window.addEventListener('resize', onWinResize)
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && route.overlay) {
        e.preventDefault()
        closeOverlay()
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
          agentDrawer?.newChat()
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
      window.removeEventListener('resize', onWinResize)
      window.removeEventListener('keydown', onKeydown)
    }
  })

  $effect(() => {
    try {
      localStorage.setItem(AGENT_PANEL_WIDTH_KEY, String(detailPanelWidth))
    } catch { /* ignore */ }
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

  function onDetailResizePointerDown(e: PointerEvent) {
    if (typeof window !== 'undefined' && window.innerWidth <= 767) return
    e.preventDefault()
    const el = e.currentTarget as HTMLButtonElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = detailPanelWidth
    detailPanelResizing = true
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: PointerEvent) {
      detailPanelWidth = nextPanelWidthAfterDrag(startW, startX, ev.clientX, window.innerWidth)
    }
    function onUp(ev: PointerEvent) {
      detailPanelResizing = false
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function closeOverlay() {
    navigate({})
    route = parseRoute()
    agentContext = { type: 'chat' }
  }

  function openWikiDoc(path?: string) {
    const overlay: Overlay = path ? { type: 'wiki', path } : { type: 'wiki' }
    navigate({ overlay })
    route = parseRoute()
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

  function switchToCalendar(date: string) {
    navigate({ overlay: { type: 'calendar', date } })
    route = parseRoute()
  }

  function setContext(ctx: SurfaceContext) {
    agentContext = ctx
  }

  function onSummarizeInbox(message: string) {
    agentContext = { type: 'inbox' }
    void agentDrawer?.newChatWithMessage(message)
  }

  function openEmailFromSearch(id: string, subject: string, from: string) {
    inboxTargetId = id
    navigate({ overlay: { type: 'email', id } })
    route = parseRoute()
    agentContext = { type: 'email', threadId: id, subject, from }
  }

  function openEmailFromChat(threadId: string) {
    openEmailFromSearch(threadId, threadId, '')
  }

  /** LLM `open` tool — navigate immediately on tool_start. */
  function onOpenFromAgent(target: { type: string; path?: string; id?: string; date?: string }) {
    if (target.type === 'wiki' && target.path) {
      openWikiDoc(target.path)
      return
    }
    if (target.type === 'email' && target.id) {
      openEmailFromSearch(target.id, '', '')
      return
    }
    if (target.type === 'calendar' && target.date) {
      switchToCalendar(target.date)
    }
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
</script>

{#if showSearch}
  <Search
    onOpenWiki={(path) => { openWikiDoc(path); showSearch = false }}
    onOpenEmail={(id, subject, from) => { openEmailFromSearch(id, subject, from); showSearch = false }}
    onClose={() => showSearch = false}
  />
{/if}

<div class="app">
  {#if !(isMobile && route.overlay)}
  <AppTopNav
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
  />
  {/if}

  <div class="workspace">
    <div class="split" class:has-detail={!!route.overlay}>
      <section class="chat-pane">
        <AgentDrawer
          bind:this={agentDrawer}
          context={agentContext}
          conversationHidden={!!route.overlay && isMobile}
          onOpenWiki={openWikiDoc}
          onOpenEmail={openEmailFromChat}
          onSwitchToCalendar={switchToCalendar}
          onOpenFromAgent={onOpenFromAgent}
          onNewChat={closeOverlay}
        >
          {#snippet mobileDetail()}
            {#if route.overlay}
              <SlideOver
                overlay={route.overlay}
                surfaceContext={agentContext}
                wikiRefreshKey={wikiRefreshKey}
                calendarRefreshKey={calendarRefreshKey}
                inboxTargetId={inboxTargetId}
                onWikiNavigate={onWikiNavigate}
                onInboxNavigate={onInboxNavigateSlide}
                onContextChange={setContext}
                onOpenSearch={() => { showSearch = true }}
                onSummarizeInbox={onSummarizeInbox}
                onClose={closeOverlay}
                onSync={syncAll}
                {syncing}
              />
            {/if}
          {/snippet}
        </AgentDrawer>
      </section>

      {#if route.overlay && !isMobile}
        <section
          class="detail-pane"
          class:resizing={detailPanelResizing}
          style:--detail-w="{detailPanelWidth}px"
        >
          <button
            type="button"
            class="detail-resize-handle"
            aria-label="Resize detail panel"
            title="Drag to resize"
            onpointerdown={onDetailResizePointerDown}
          >
            <span class="detail-resize-grip" aria-hidden="true"></span>
          </button>
          <SlideOver
            overlay={route.overlay}
            surfaceContext={agentContext}
            wikiRefreshKey={wikiRefreshKey}
            calendarRefreshKey={calendarRefreshKey}
            inboxTargetId={inboxTargetId}
            onWikiNavigate={onWikiNavigate}
            onInboxNavigate={onInboxNavigateSlide}
            onContextChange={setContext}
            onOpenSearch={() => { showSearch = true }}
            onSummarizeInbox={onSummarizeInbox}
            onClose={closeOverlay}
          />
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .workspace {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
  }

  .split {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }

  .chat-pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    z-index: 0;
  }

  .detail-pane {
    --detail-w: 420px;
    position: relative;
    z-index: 1;
    width: var(--detail-w);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow: visible;
  }

  .detail-resize-handle {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 16px;
    margin-left: -8px;
    z-index: 3;
    cursor: col-resize;
    touch-action: none;
    border: none;
    padding: 0;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .detail-resize-grip {
    width: 8px;
    height: 30px;
    border-radius: 4px;
    opacity: 0.45;
    background-color: var(--text-2);
    background-image: repeating-linear-gradient(
      180deg,
      transparent 0 4px,
      rgba(0, 0, 0, 0.1) 4px 5px
    );
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.22),
      inset 0 -1px 0 rgba(0, 0, 0, 0.12);
  }

  .detail-pane.resizing .detail-resize-grip {
    opacity: 1;
  }
</style>
