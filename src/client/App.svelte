<script lang="ts">
  import { onMount } from 'svelte'
  import Search from './lib/Search.svelte'
  import AppTopNav from './lib/AppTopNav.svelte'
  import AppSurface from './lib/AppSurface.svelte'
  import AppAgentColumn from './lib/AppAgentColumn.svelte'
  import { parseRoute, navigate, type Route, type SurfaceContext } from './router.js'
  import {
    AGENT_PANEL_WIDTH_KEY,
    DEFAULT_AGENT_PANEL_WIDTH,
    clampAgentPanelWidth,
    nextPanelWidthAfterDrag,
  } from './lib/app/agentPanelWidth.js'
  import { runParallelSyncs } from './lib/app/syncAllServices.js'
  import { matchGlobalShortcut, TAB_ORDER } from './lib/app/globalShortcuts.js'

  let route = $state<Route>(parseRoute())
  let syncing = $state(false)
  let syncErrors = $state<string[]>([])
  let showSyncErrors = $state(false)
  let calendarRefreshKey = $state(0)
  let wikiRefreshKey = $state(0)
  let drawerOpen = $state(true)
  let agentPanelWidth = $state(DEFAULT_AGENT_PANEL_WIDTH)
  let agentPanelResizing = $state(false)
  let showSearch = $state(false)
  let inboxTargetId = $state<string | undefined>()
  let agentColumn = $state<AppAgentColumn | undefined>()

  // Surface context — driven by whichever surface is active
  let agentContext = $state<SurfaceContext>({ type: 'today', date: new Date().toISOString().slice(0, 10) })

  // Wiki recent files (agent edit/write history in data/) + unsaved dirty files
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
        if (!Number.isNaN(n)) agentPanelWidth = clampAgentPanelWidth(n, window.innerWidth)
      }
    } catch { /* ignore */ }

    loadWikiEditHistory()
    loadGitStatus()
    const onPopState = () => { route = parseRoute() }
    window.addEventListener('popstate', onPopState)
    const onWinResize = () => {
      agentPanelWidth = clampAgentPanelWidth(agentPanelWidth, window.innerWidth)
    }
    window.addEventListener('resize', onWinResize)
    const onKeydown = (e: KeyboardEvent) => {
      const action = matchGlobalShortcut(e)
      if (!action) return
      e.preventDefault()
      switch (action.type) {
        case 'search':
          showSearch = true
          break
        case 'newChat':
          agentColumn?.newChat()
          break
        case 'refresh':
          if (!syncing) void syncAll()
          break
        case 'tab': {
          const tab = TAB_ORDER[action.index]
          if (tab) switchTab(tab)
          break
        }
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('resize', onWinResize)
      window.removeEventListener('keydown', onKeydown)
    }
  })

  $effect(() => {
    try {
      localStorage.setItem(AGENT_PANEL_WIDTH_KEY, String(agentPanelWidth))
    } catch { /* ignore */ }
  })

  function onAgentPanelResizePointerDown(e: PointerEvent) {
    if (typeof window !== 'undefined' && window.innerWidth <= 767) return
    e.preventDefault()
    const el = e.currentTarget as HTMLButtonElement
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = agentPanelWidth
    agentPanelResizing = true
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: PointerEvent) {
      agentPanelWidth = nextPanelWidthAfterDrag(startW, startX, ev.clientX, window.innerWidth)
    }
    function onUp(ev: PointerEvent) {
      agentPanelResizing = false
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function switchTab(tab: Route['tab']) {
    const next: Route = { tab }
    navigate(next)
    route = next
  }

  function openWikiDoc(path: string) {
    const next: Route = { tab: 'wiki', path }
    navigate(next)
    route = next
  }

  function onInboxNavigate(id: string | undefined) {
    route = { tab: 'inbox', id }
  }

  function switchToCalendar(date: string) {
    const next: Route = { tab: 'calendar', date }
    navigate(next)
    route = next
  }

  function setContext(ctx: SurfaceContext) {
    agentContext = ctx
  }

  function openEmailFromSearch(id: string, subject: string, from: string) {
    inboxTargetId = id
    const next: Route = { tab: 'inbox', id }
    navigate(next)
    route = next
    agentContext = { type: 'email', threadId: id, subject, from }
  }

  async function syncAll() {
    syncing = true
    syncErrors = []
    showSyncErrors = false
    try {
      syncErrors = await runParallelSyncs(fetch)
      calendarRefreshKey++
      wikiRefreshKey++
      loadWikiEditHistory()
      loadGitStatus()
    } finally {
      syncing = false
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
    {route}
    {dirtyFiles}
    {recentFiles}
    {showRecentFiles}
    {syncing}
    {syncErrors}
    {showSyncErrors}
    onSelectTab={switchTab}
    onOpenSearch={() => { showSearch = true }}
    onToggleRecentFiles={() => { showRecentFiles = !showRecentFiles }}
    onOpenWikiFromList={(path) => { openWikiDoc(path); showRecentFiles = false }}
    onSync={syncAll}
    onToggleSyncErrors={() => { showSyncErrors = !showSyncErrors }}
  />

  <div class="layout">
    <main class="surface">
      <AppSurface
        {route}
        {wikiRefreshKey}
        {calendarRefreshKey}
        {inboxTargetId}
        {dirtyFiles}
        {recentFiles}
        onOpenWiki={openWikiDoc}
        onInboxNavigate={onInboxNavigate}
        onContextChange={setContext}
        onOpenSearch={() => { showSearch = true }}
        onRouteChange={(r) => { route = r }}
      />
    </main>

    <AppAgentColumn
      bind:this={agentColumn}
      drawerOpen={drawerOpen}
      agentPanelWidth={agentPanelWidth}
      agentPanelResizing={agentPanelResizing}
      agentContext={agentContext}
      onResizePointerDown={onAgentPanelResizePointerDown}
      onToggle={() => { drawerOpen = !drawerOpen }}
      onOpenWiki={openWikiDoc}
      onSwitchToCalendar={switchToCalendar}
    />
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .layout {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
  }

  .surface {
    flex: 1;
    overflow: hidden;
    position: relative;
    min-width: 0;
    z-index: 0;
  }

  /* Leave room for the collapsed agent header bar on small screens */
  @media (max-width: 767px) {
    .surface {
      padding-bottom: 52px;
    }
  }
</style>
