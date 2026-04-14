<script lang="ts">
  import { onMount } from 'svelte'
  import Search from './lib/Search.svelte'
  import AppTopNav from './lib/AppTopNav.svelte'
  import SlideOver from './lib/SlideOver.svelte'
  import AgentDrawer from './lib/AgentDrawer.svelte'
  import WorkspaceSplit from './lib/WorkspaceSplit.svelte'
  import { parseRoute, navigate, type Route, type SurfaceContext, type Overlay } from './router.js'
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
  let showSearch = $state(false)
  let inboxTargetId = $state<string | undefined>()
  let agentDrawer = $state<AgentDrawer | undefined>()
  let mobileSlideOver = $state<{ closeAnimated: () => void } | undefined>()
  let workspaceSplit = $state<WorkspaceSplit | undefined>()
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
    const mq = window.matchMedia('(max-width: 767px)')
    const syncMobile = () => { isMobile = mq.matches }
    syncMobile()
    mq.addEventListener('change', syncMobile)

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
  }

  function closeOverlay() {
    if (!route.overlay) return
    if (isMobile) {
      closeOverlayImmediate()
      return
    }
    workspaceSplit?.closeDesktopAnimated()
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

  function openFullInboxFromChat() {
    inboxTargetId = undefined
    navigate({ overlay: { type: 'email' } })
    route = parseRoute()
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

  <WorkspaceSplit
    bind:this={workspaceSplit}
    hasDetail={!!route.overlay}
    desktopDetailOpen={!!route.overlay && !isMobile}
    onNavigateClear={closeOverlayImmediate}
  >
    {#snippet chat()}
      <AgentDrawer
        bind:this={agentDrawer}
        context={agentContext}
        conversationHidden={!!route.overlay && isMobile}
        onOpenWiki={openWikiDoc}
        onOpenEmail={openEmailFromChat}
        onOpenFullInbox={openFullInboxFromChat}
        onSwitchToCalendar={switchToCalendar}
        onOpenFromAgent={onOpenFromAgent}
        onNewChat={closeOverlay}
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
              onWikiNavigate={onWikiNavigate}
              onInboxNavigate={onInboxNavigateSlide}
              onContextChange={setContext}
              onOpenSearch={() => { showSearch = true }}
              onSummarizeInbox={onSummarizeInbox}
              onClose={closeOverlay}
              onSync={syncAll}
              {syncing}
              mobilePanel
            />
          {/if}
        {/snippet}
      </AgentDrawer>
    {/snippet}
    {#snippet desktopDetail()}
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
        />
      {/if}
    {/snippet}
  </WorkspaceSplit>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
</style>
