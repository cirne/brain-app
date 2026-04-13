<script lang="ts">
  import { onMount } from 'svelte'
  import DayEvents from './DayEvents.svelte'
  import WikiFileList from './WikiFileList.svelte'
  import { formatDate } from './formatDate.js'

  type InboxItem = { id: string; from: string; subject: string; date: string; read: boolean }

  let {
    onNewChat,
    onOpenWiki,
    dirty = [],
    recent = [],
  }: {
    onNewChat: (_message: string) => void
    onOpenWiki: (_path: string) => void
    dirty?: string[]
    recent?: { path: string; date: string }[]
  } = $props()

  const today = new Date().toISOString().slice(0, 10)
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  let inboxItems = $state<InboxItem[]>([])
  let inboxLoading = $state(true)
  let chatInput = $state('')

  onMount(async () => {
    const res = await fetch('/api/inbox').catch(() => null)
    inboxItems = res?.ok ? await res.json() : []
    inboxLoading = false
  })

  const unreadCount = $derived(inboxItems.filter((m: InboxItem) => !m.read).length)

  function submitChat() {
    const msg = chatInput.trim()
    if (!msg) return
    chatInput = ''
    onNewChat(msg)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitChat()
    }
  }

</script>

<div class="home">
  <div class="home-inner">
    <h1 class="date-heading">{todayLabel}</h1>

    <!-- Today's calendar -->
    <section class="card">
      <h2 class="section-title">Today</h2>
      <DayEvents date={today} />
    </section>

    <!-- Inbox summary -->
    <section class="card">
      <h2 class="section-title">
        Inbox
        {#if unreadCount > 0}
          <span class="badge">{unreadCount} unread</span>
        {/if}
      </h2>
      {#if inboxLoading}
        <div class="muted">Loading…</div>
      {:else if inboxItems.length === 0}
        <div class="muted">No messages</div>
      {:else}
        <ul class="item-list">
          {#each inboxItems.slice(0, 5) as msg (msg.id)}
            <li class="inbox-item" class:unread={!msg.read}>
              <span class="inbox-from">{msg.from}</span>
              <span class="inbox-subject">{msg.subject}</span>
              <span class="inbox-date">{formatDate(msg.date)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Recent wiki changes -->
    <section class="card card--files">
      <h2 class="section-title">Wiki</h2>
      {#if dirty.length === 0 && recent.length === 0}
        <div class="muted">No recent changes</div>
      {:else}
        <WikiFileList {dirty} {recent} onOpen={onOpenWiki} showSectionLabels={dirty.length > 0} />
      {/if}
    </section>

    <!-- Actions -->
    <div class="actions">
      <button class="briefing-btn" onclick={() => onNewChat('Give me a daily briefing')}>
        Daily briefing
      </button>
    </div>

    <!-- Chat input -->
    <div class="chat-wrap">
      <input
        class="chat-input"
        type="text"
        placeholder="Ask anything…"
        bind:value={chatInput}
        onkeydown={handleKeydown}
      />
      <button class="send-btn" onclick={submitChat} disabled={!chatInput.trim()} aria-label="Send">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  .home {
    height: 100%;
    overflow-y: auto;
    padding: 24px 16px 40px;
  }

  .home-inner {
    max-width: 560px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .date-heading {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 4px;
  }

  /* ── cards ────────────────────────────────────────────────── */

  .card {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
    margin: 0 0 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .badge {
    font-size: 10px;
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    background: var(--accent);
    color: #fff;
    border-radius: 10px;
    padding: 1px 7px;
  }

  .muted {
    font-size: 12px;
    color: var(--text-2);
    opacity: 0.7;
  }

  /* ── inbox items ──────────────────────────────────────────── */

  .item-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .inbox-item {
    display: grid;
    grid-template-columns: minmax(0, 130px) 1fr auto;
    gap: 8px;
    align-items: baseline;
    padding: 5px 6px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-2);
  }

  .inbox-item.unread {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .inbox-from {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: inherit;
  }

  .inbox-item.unread .inbox-from { color: var(--accent); }

  .inbox-subject {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inbox-date {
    font-size: 11px;
    color: var(--text-2);
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* wiki file list — flush to card edges, WikiFileList handles item styling */
  .card--files {
    padding: 14px 0 0;
    overflow: hidden;
  }
  .card--files .section-title { padding: 0 16px 10px; }
  .card--files .muted { padding: 0 16px 14px; }

  /* ── actions ──────────────────────────────────────────────── */

  .actions {
    display: flex;
    gap: 8px;
  }

  .briefing-btn {
    font-size: 13px;
    font-weight: 500;
    color: var(--accent);
    background: var(--accent-dim);
    border-radius: 6px;
    padding: 8px 16px;
    transition: background 0.15s;
  }

  .briefing-btn:hover {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }

  /* ── chat input ───────────────────────────────────────────── */

  .chat-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px 6px 12px;
    transition: border-color 0.15s;
  }

  .chat-wrap:focus-within {
    border-color: var(--accent);
  }

  .chat-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 14px;
    color: var(--text);
  }

  .chat-input::placeholder {
    color: var(--text-2);
    opacity: 0.6;
  }

  .send-btn {
    width: 30px;
    height: 30px;
    border-radius: 6px;
    background: var(--accent);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }

  .send-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .send-btn:not(:disabled):hover {
    opacity: 0.85;
  }
</style>
