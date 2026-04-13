<script lang="ts">
  import { onMount } from 'svelte'
  import Chat from './lib/Chat.svelte'
  import Wiki from './lib/Wiki.svelte'
  import Inbox from './lib/Inbox.svelte'
  import Calendar from './lib/Calendar.svelte'
  import Home from './lib/Home.svelte'
  import WikiFileName from './lib/WikiFileName.svelte'
  import { parseRoute, navigate, type Route } from './router.js'

  type LogEntry = { date: string; type: string; description: string; files: string[] }

  // Types mirrored from Chat.svelte for typing persisted state
  type ToolCall = { id: string; name: string; args: any; result?: string; isError?: boolean; done: boolean }
  type MessagePart = { type: 'text'; content: string } | { type: 'tool'; toolCall: ToolCall }
  type ChatMessage = { role: 'user' | 'assistant'; content: string; parts?: MessagePart[]; thinking?: string }

  const CHAT_STORAGE_KEY = 'brain-chat'

  function loadChat(): { messages: ChatMessage[]; sessionId: string | null } {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch { /* ignore */ }
    return { messages: [], sessionId: null }
  }

  const savedChat = loadChat()
  let chatMessages = $state<ChatMessage[]>(savedChat.messages)
  let chatSessionId = $state<string | null>(savedChat.sessionId)

  $effect(() => {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ messages: chatMessages, sessionId: chatSessionId }))
    } catch { /* ignore */ }
  })

  let route = $state<Route>(parseRoute())
  let syncing = $state(false)
  let syncErrors = $state<string[]>([])
  let showSyncErrors = $state(false)
  let calendarRefreshKey = $state(0)
  let wikiRefreshKey = $state(0)

  // Wiki recent files (from _log.md)
  let logEntries = $state<LogEntry[]>([])
  let showRecentFiles = $state(false)

  const recentFiles = $derived.by(() => {
    const seen = new Set<string>()
    const files: { path: string; date: string }[] = []
    for (const entry of logEntries) {
      for (const path of (entry.files ?? [])) {
        if (!seen.has(path)) {
          seen.add(path)
          files.push({ path, date: entry.date })
        }
      }
      if (files.length >= 15) break
    }
    return files
  })

  async function loadWikiLog() {
    try {
      const res = await fetch('/api/wiki/log?limit=15')
      const data = await res.json()
      logEntries = data.entries ?? []
    } catch { /* ignore */ }
  }

  // Wiki panel — shown as right panel (large) or bottom drawer (small/medium)
  let wikiPanelPath = $state<string | null>(null)
  let wikiPanelOpen = $derived(wikiPanelPath !== null)

  onMount(() => {
    loadWikiLog()
    const onPopState = () => { route = parseRoute() }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  })

  function switchTab(tab: Route['tab']) {
    const next: Route = { tab }
    navigate(next)
    route = next
  }

  function startNewChat(message: string) {
    chatMessages = []
    chatSessionId = null
    const next: Route = { tab: 'chat', message }
    navigate(next)
    route = next
  }

  function openWikiPanel(path: string) {
    wikiPanelPath = path
  }

  function closeWikiPanel() {
    wikiPanelPath = null
  }

  function onInboxNavigate(id: string | undefined) {
    route = { tab: 'inbox', id }
  }

  function switchToCalendar(date: string) {
    const next: Route = { tab: 'calendar', date }
    navigate(next)
    route = next
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
      loadWikiLog()
    } catch (e) {
      syncErrors = [`Unexpected error: ${e}`]
    } finally {
      syncing = false
    }
  }

  function formatLogDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
</script>

<div class="app">
  <nav class="tabs">
    <div class="tab-group">
      <button class:active={route.tab === 'home'} onclick={() => switchTab('home')}>Home</button>
      <button class:active={route.tab === 'chat'} onclick={() => switchTab('chat')}>Chat</button>
      <button class:active={route.tab === 'inbox'} onclick={() => switchTab('inbox')}>Inbox</button>
      <button class:active={route.tab === 'calendar'} onclick={() => switchTab('calendar')}>Calendar</button>
    </div>
    {#if recentFiles.length > 0}
      <div class="log-wrap">
        <button
          class="log-btn"
          onclick={() => { showRecentFiles = !showRecentFiles }}
          title="Recently changed wiki files"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <span class="log-date">{recentFiles[0].path.split('/').pop()?.replace(/\.md$/, '')}</span>
        </button>
        {#if showRecentFiles}
          <div class="log-dropdown">
            {#each recentFiles as file}
              <button
                class="log-item"
                onmousedown={(e) => { e.preventDefault(); openWikiPanel(file.path); showRecentFiles = false }}
              >
                <span class="log-item-date">{formatLogDate(file.date)}</span>
                <WikiFileName path={file.path} />
              </button>
            {/each}
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
      {#if route.tab === 'home'}
        <Home onNewChat={startNewChat} onOpenWiki={openWikiPanel} />
      {:else if route.tab === 'chat'}
        <Chat bind:messages={chatMessages} bind:sessionId={chatSessionId} contextFiles={route.file ? [route.file] : []} initialMessage={route.message} onSwitchToWiki={openWikiPanel} onSwitchToCalendar={switchToCalendar} />
      {:else if route.tab === 'calendar'}
        <Calendar refreshKey={calendarRefreshKey} initialDate={route.tab === 'calendar' ? route.date : undefined} />
      {:else}
        <Inbox
          initialId={route.id}
          onNavigate={onInboxNavigate}
        />
      {/if}
    </main>

    {#if wikiPanelOpen}
      <div class="wiki-backdrop" role="button" tabindex="-1" onclick={closeWikiPanel} onkeydown={(e) => e.key === 'Escape' && closeWikiPanel()}></div>
      <aside class="wiki-panel">
        <div class="wiki-panel-header">
          <button class="wiki-close-btn" onclick={closeWikiPanel} title="Close wiki">✕</button>
        </div>
        <Wiki
          initialPath={wikiPanelPath ?? undefined}
          refreshKey={wikiRefreshKey}
          onNavigate={(path) => { if (path) wikiPanelPath = path }}
        />
      </aside>
    {/if}
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
    height: 100%;
    color: var(--text-2);
    transition: background 0.15s;
  }
  .log-btn:hover { background: var(--bg-3); }
  .log-btn svg { flex-shrink: 0; }

  .log-date {
    font-size: 11px;
    color: var(--text-2);
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .log-item {
    display: grid;
    grid-template-columns: 52px 1fr;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 7px 12px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .log-item:last-child { border-bottom: none; }
  .log-item:hover { background: var(--bg-2); color: var(--accent); }

  .log-item-date {
    font-size: 11px;
    color: var(--text-2);
    flex-shrink: 0;
  }

  .log-item :global(.wfn) {
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
  }
  .log-item:hover :global(.wfn-name) { color: var(--accent); }
  .log-item:hover :global(.wfn-folder) { color: var(--accent); opacity: 0.7; }

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

  .sync-btn {
    width: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
    transition: color 0.15s;
    height: 100%;
  }

  .sync-btn:hover:not(:disabled) { color: var(--text); }
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
  }

  /* ── wiki panel (large screens: right panel) ─────────────── */

  .wiki-backdrop {
    display: none;
  }

  .wiki-panel {
    width: 420px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    background: var(--bg-2);
    overflow: hidden;
  }

  .wiki-panel-header {
    display: flex;
    justify-content: flex-end;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }

  .wiki-close-btn {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    color: var(--text-2);
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, background 0.15s;
  }
  .wiki-close-btn:hover {
    color: var(--text);
    background: var(--bg-3);
  }

  /* ── wiki drawer (small/medium screens) ─────────────────── */

  @media (max-width: 767px) {
    .log-date { display: none; }

    .wiki-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 40;
    }

    .wiki-panel {
      position: fixed;
      bottom: 0;
      left: 5vw;
      right: 5vw;
      width: 90vw;
      height: 78vh;
      border-left: none;
      border-top: 1px solid var(--border);
      border-radius: 12px 12px 0 0;
      z-index: 50;
    }

    .wiki-panel-header {
      border-radius: 12px 12px 0 0;
    }
  }
</style>
