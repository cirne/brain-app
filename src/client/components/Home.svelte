<script lang="ts">
  import { onMount } from 'svelte'
  import DayEvents from './DayEvents.svelte'
  import WikiFileList from './WikiFileList.svelte'
  import { subscribe } from '@client/lib/app/appEvents.js'
  import { formatDate } from '@client/lib/formatDate.js'

  type InboxItem = { id: string; from: string; subject: string; date: string; read: boolean }

  import type { SurfaceContext } from '@client/router.js'

  let {
    onOpenWiki,
    onOpenInbox,
    onContextChange,
    dirty = [],
    recent = [],
  }: {
    onOpenWiki: (_path: string) => void
    onOpenInbox: (_id: string) => void
    onContextChange?: (_ctx: SurfaceContext) => void
    dirty?: string[]
    recent?: { path: string; date: string }[]
  } = $props()

  const today = new Date().toISOString().slice(0, 10)
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  let inboxItems = $state<InboxItem[]>([])
  let inboxLoading = $state(true)

  async function loadInbox() {
    inboxLoading = true
    try {
      const res = await fetch('/api/inbox').catch(() => null)
      inboxItems = res?.ok ? await res.json() : []
    } finally {
      inboxLoading = false
    }
  }

  onMount(() => {
    void (async () => {
      await loadInbox()
      onContextChange?.({ type: 'chat' })
    })()
    return subscribe((e) => {
      if (e.type === 'sync:completed') void loadInbox()
    })
  })

  const unreadCount = $derived(inboxItems.filter((m: InboxItem) => !m.read).length)

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
            <li>
              <button class="inbox-item" class:unread={!msg.read} onclick={() => onOpenInbox(msg.id)}>
                <span class="inbox-from">{msg.from}</span>
                <span class="inbox-subject">{msg.subject}</span>
                <span class="inbox-date">{formatDate(msg.date)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Recent doc changes -->
    <section class="card card--files">
      <h2 class="section-title">Docs</h2>
      {#if dirty.length === 0 && recent.length === 0}
        <div class="muted">No recent changes</div>
      {:else}
        <WikiFileList {dirty} {recent} onOpen={onOpenWiki} showSectionLabels={dirty.length > 0} />
      {/if}
    </section>

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
    width: 100%;
    text-align: left;
    cursor: pointer;
    padding: 5px 6px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-2);
  }

  .inbox-item:hover {
    background: var(--bg-3);
  }

  .inbox-item.unread {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .inbox-item.unread:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
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

  /* docs file list — flush to card edges, WikiFileList handles item styling */
  .card--files {
    padding: 14px 0 0;
    overflow: hidden;
  }
  .card--files .section-title { padding: 0 16px 10px; }
  .card--files .muted { padding: 0 16px 14px; }

</style>
