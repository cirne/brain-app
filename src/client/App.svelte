<script lang="ts">
  import { onMount } from 'svelte'
  import Wiki from './lib/Wiki.svelte'
  import Inbox from './lib/Inbox.svelte'
  import Calendar from './lib/Calendar.svelte'
  import Home from './lib/Home.svelte'
  import WikiFileList from './lib/WikiFileList.svelte'
  import AgentDrawer from './lib/AgentDrawer.svelte'
  import Search from './lib/Search.svelte'
  import { parseRoute, navigate, type Route, type SurfaceContext } from './router.js'

  const AGENT_PANEL_WIDTH_KEY = 'brain-agent-panel-width'
  const DEFAULT_AGENT_PANEL_WIDTH = 420
  const MIN_AGENT_PANEL_WIDTH = 280

  function maxAgentPanelWidth(): number {
    if (typeof window === 'undefined') return 920
    return Math.min(920, Math.max(MIN_AGENT_PANEL_WIDTH, window.innerWidth - 320))
  }

  function clampAgentPanelWidth(w: number): number {
    return Math.min(maxAgentPanelWidth(), Math.max(MIN_AGENT_PANEL_WIDTH, Math.round(w)))
  }

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
        if (!Number.isNaN(n)) agentPanelWidth = clampAgentPanelWidth(n)
      }
    } catch { /* ignore */ }

    loadWikiEditHistory()
    loadGitStatus()
    const onPopState = () => { route = parseRoute() }
    window.addEventListener('popstate', onPopState)
    const onWinResize = () => {
      agentPanelWidth = clampAgentPanelWidth(agentPanelWidth)
    }
    window.addEventListener('resize', onWinResize)
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        showSearch = true
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
      agentPanelWidth = clampAgentPanelWidth(startW + (startX - ev.clientX))
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
      const [wikiRes, inboxRes, calRes] = await Promise.allSettled([
        fetch('/api/wiki/sync', { method: 'POST' }).then(r => r.json()),
        fetch('/api/inbox/sync', { method: 'POST' }).then(r => r.json()),
        fetch('/api/calendar/sync', { method: 'POST' }).then(r => r.json()),
      ])
      const errs: string[] = []
      if (wikiRes.status === 'rejected') errs.push(`Wiki: ${wikiRes.reason}`)
      else if (wikiRes.value && !wikiRes.value.ok) errs.push(`Wiki: ${wikiRes.value.error ?? 'sync failed'}`)
      if (inboxRes.status === 'rejected') errs.push(`Inbox: ${inboxRes.reason}`)
      else if (inboxRes.value && !inboxRes.value.ok) errs.push(`Inbox: ${inboxRes.value.error ?? 'sync failed'}`)
      if (calRes.status === 'rejected') errs.push(`Calendar: ${calRes.reason}`)
      else if (calRes.value && !calRes.value.ok) errs.push(`Calendar: ${calRes.value.error ?? 'sync failed'}`)
      syncErrors = errs
      calendarRefreshKey++
      wikiRefreshKey++
      loadWikiEditHistory()
      loadGitStatus()
    } catch (e) {
      syncErrors = [`Unexpected error: ${e}`]
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
  <nav class="tabs">
    <div class="tab-group">
      <button class:active={route.tab === 'today'} onclick={() => switchTab('today')}>Today</button>
      <button class:active={route.tab === 'inbox'} onclick={() => switchTab('inbox')}>Inbox</button>
      <button class:active={route.tab === 'wiki'} onclick={() => switchTab('wiki')}>Wiki</button>
      <button class:active={route.tab === 'calendar'} onclick={() => switchTab('calendar')}>Calendar</button>
    </div>
    <div class="search-wrap">
      <button class="search-btn" onclick={() => showSearch = true} title="Search (⌘K)" aria-label="Search">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
      </button>
    </div>
    {#if dirtyFiles.length > 0}
      <div class="log-wrap">
        <button
          class="log-btn"
          onclick={() => { showRecentFiles = !showRecentFiles }}
          title="Unsynced wiki files"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <span class="dirty-badge" title="{dirtyFiles.length} unsaved file{dirtyFiles.length === 1 ? '' : 's'}">{dirtyFiles.length}</span>
        </button>
        {#if showRecentFiles}
          <div class="log-dropdown" role="menu">
            <WikiFileList
              dirty={dirtyFiles}
              recent={recentFiles}
              showRecent={false}
              onOpen={(path) => { openWikiDoc(path); showRecentFiles = false }}
            />
          </div>
        {/if}
      </div>
    {/if}
    <div class="sync-wrap">
      <button class="sync-btn" onclick={syncAll} disabled={syncing} title="Sync wiki, email, and calendar">
        <svg class:spinning={syncing} xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
          <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        </svg>
      </button>
      {#if syncErrors.length > 0}
        <button class="sync-error-badge" onclick={() => showSyncErrors = !showSyncErrors} title="Show sync errors">!</button>
        {#if showSyncErrors}
          <div class="sync-error-popup">
            <div class="sync-error-title">Sync errors</div>
            {#each syncErrors as err}
              <div class="sync-error-item">{err}</div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  </nav>

  <div class="layout">
    <main class="surface">
      {#if route.tab === 'today'}
        <Home
          onOpenWiki={openWikiDoc}
          onOpenInbox={(id) => onInboxNavigate(id)}
          dirty={dirtyFiles}
          recent={recentFiles}
          onContextChange={setContext}
        />
      {:else if route.tab === 'wiki'}
        <Wiki
          initialPath={route.path}
          refreshKey={wikiRefreshKey}
          onNavigate={(path) => {
            if (path) { const next: Route = { tab: 'wiki', path }; navigate(next); route = next }
          }}
          onContextChange={setContext}
        />
      {:else if route.tab === 'calendar'}
        <Calendar
          refreshKey={calendarRefreshKey}
          initialDate={route.tab === 'calendar' ? route.date : undefined}
          onContextChange={setContext}
        />
      {:else}
        <Inbox
          initialId={route.id}
          targetId={inboxTargetId}
          onNavigate={onInboxNavigate}
          onContextChange={setContext}
          onOpenSearch={() => showSearch = true}
        />
      {/if}
    </main>

    <div
      class="agent-panel"
      class:open={drawerOpen}
      class:resizing={agentPanelResizing}
      style:--panel-w="{agentPanelWidth}px"
    >
      <button
        type="button"
        class="agent-resize-handle"
        aria-label="Resize chat panel"
        title="Drag to resize"
        onpointerdown={onAgentPanelResizePointerDown}
      >
        <span class="agent-resize-grip" aria-hidden="true"></span>
      </button>
      <AgentDrawer
        context={agentContext}
        open={drawerOpen}
        onToggle={() => drawerOpen = !drawerOpen}
        onOpenWiki={openWikiDoc}
        onSwitchToCalendar={switchToCalendar}
      />
    </div>
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .tabs {
    display: flex;
    align-items: stretch;
    height: var(--tab-h);
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }

  /* ── search button ──────────────────────────────────────── */

  .search-wrap {
    display: flex;
    align-items: center;
    border-left: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search-btn {
    width: 40px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    transition: color 0.15s;
  }
  .search-btn:hover { color: var(--text); }

  /* ── wiki log indicator ──────────────────────────────────── */

  .log-wrap {
    position: relative;
    display: flex;
    align-items: center;
    border-left: 1px solid var(--border);
    flex-shrink: 0;
  }

  .log-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
  }
  .log-btn svg { flex-shrink: 0; }

  .dirty-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: #e8a020;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
  }

  .log-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 260px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 200;
  }

  /* ── tabs ────────────────────────────────────────────────── */

  .tab-group {
    display: flex;
    flex: 1;
  }

  .tab-group button {
    flex: 1;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-2);
    letter-spacing: 0.02em;
    transition: color 0.15s;
  }

  .tab-group button:hover {
    color: var(--text);
  }

  .tab-group button.active {
    color: var(--accent);
    border-bottom: 2px solid var(--accent);
  }

  /* ── sync button ─────────────────────────────────────────── */

  .sync-wrap {
    position: relative;
    display: flex;
    align-items: center;
    border-left: 1px solid var(--border);
    flex-shrink: 0;
  }
  .log-wrap + .sync-wrap {
    border-left: none;
  }

  .log-btn, .sync-btn {
    color: var(--text-2);
    transition: color 0.15s;
    height: 100%;
  }
  .log-btn:hover, .sync-btn:hover:not(:disabled) { color: var(--text); }

  .sync-btn {
    width: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sync-btn:disabled { opacity: 0.5; cursor: default; }
  .sync-btn svg { display: block; }

  .sync-error-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #e74c3c;
    color: white;
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    cursor: pointer;
  }
  .sync-error-badge:hover { background: #c0392b; }

  .sync-error-popup {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 220px;
    background: var(--bg-3);
    border: 1px solid #e74c3c;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    z-index: 200;
    overflow: hidden;
  }

  .sync-error-title {
    padding: 6px 12px;
    font-size: 11px;
    font-weight: 600;
    color: #e74c3c;
    border-bottom: 1px solid var(--border);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .sync-error-item {
    padding: 6px 12px;
    font-size: 12px;
    color: var(--text);
    font-family: monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }

  :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* ── layout ─────────────────────────────────────────────── */

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

  /* ── agent panel ─────────────────────────────────────────── */

  .agent-panel {
    --panel-w: 420px;
    position: relative;
    z-index: 1;
    width: var(--panel-w);
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    /* allow .agent-resize-handle (negative margin) to paint over .surface — was clipping the grip */
    overflow: visible;
  }

  .agent-resize-handle {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    /* Wider than the 1px panel border so the grip straddles the split */
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

  .agent-resize-handle:hover .agent-resize-grip,
  .agent-resize-handle:focus-visible .agent-resize-grip {
    opacity: 0.95;
  }

  /* Visible grip: 8×30px, sits across the border line */
  .agent-resize-grip {
    width: 8px;
    height: 30px;
    border-radius: 4px;
    box-sizing: border-box;
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

  .agent-panel.resizing .agent-resize-grip {
    opacity: 1;
  }

  /* Small screens: collapsible bottom sheet */
  @media (max-width: 767px) {
    .agent-resize-handle {
      display: none;
    }

    .agent-panel {
      position: fixed;
      bottom: 0;
      left: 5vw;
      width: 90vw;
      height: 44px; /* collapsed: just the header */
      border-left: none;
      border-top: none;
      border-radius: 12px 12px 0 0;
      box-shadow: 0 -4px 32px rgba(0, 0, 0, 0.35);
      z-index: 50;
      overflow: hidden;
      transition: height 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .agent-panel.open {
      height: 80vh;
    }

    /* Leave room for the collapsed header bar */
    .surface {
      padding-bottom: 52px;
    }
  }

</style>
