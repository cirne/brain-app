<script lang="ts">
  import { onMount } from 'svelte'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { BookOpen, Loader2, MessageSquare, Mail, Trash2, Plus } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import { chatRowShowsAgentWorking } from '@client/lib/chatHistoryStreamingIndicator.js'
  import { labelForDeleteChatDialog } from '@client/lib/chatHistoryDelete.js'
  import {
    CHAT_HISTORY_SIDEBAR_FETCH_LIMIT,
    CHAT_HISTORY_SIDEBAR_LIMIT,
    fetchChatSessionListDeduped,
  } from '@client/lib/chatHistorySessions.js'
  import {
    loadNavHistory,
    removeFromNavHistory,
    type NavHistoryItem,
  } from '@client/lib/navHistory.js'
  import WikiFileName from '@components/WikiFileName.svelte'
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import type { ChatSessionListItem } from '@client/lib/chatSessionTypes.js'

  const emptyStreamingIds = new Set<string>()

  let {
    activeSessionId = null as string | null,
    /** Server session ids with an in-flight agent response (SSE), including background tabs. */
    streamingSessionIds = emptyStreamingIds,
    onSelect,
    onSelectDoc,
    onSelectEmail,
    onNewChat,
    onOpenAllChats,
    onWikiHome,
  }: {
    activeSessionId?: string | null
    streamingSessionIds?: ReadonlySet<string>
    onSelect: (_sessionId: string, _title?: string) => void
    onSelectDoc?: (_path: string) => void
    onSelectEmail?: (_id: string) => void
    onNewChat: () => void
    onOpenAllChats?: () => void
    onWikiHome?: () => void
  } = $props()

  let sessions = $state<ChatSessionListItem[]>([])
  let navHistory = $state<NavHistoryItem[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let pendingDelete = $state<{ sessionId: string; label: string } | null>(null)
  let hasMoreChats = $state(false)

  type NavRowItem = {
    id: string
    type: 'chat' | 'email' | 'doc'
    title: string
    timestamp: string
    path?: string
    meta?: string
    sessionId?: string
  }

  const chatItems = $derived.by(() => {
    const items: NavRowItem[] = sessions.map((s) => ({
      id: `chat:${s.sessionId}`,
      type: 'chat' as const,
      title: s.title?.trim() || s.preview?.trim() || 'New chat',
      timestamp: s.updatedAt,
      sessionId: s.sessionId,
    }))
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    return items
  })

  const recentItems = $derived.by(() => {
    const items: NavRowItem[] = []
    for (const h of navHistory) {
      if (h.type === 'doc' || h.type === 'email') {
        items.push({
          id: h.id,
          type: h.type,
          title: h.title,
          timestamp: h.accessedAt,
          path: h.path,
          meta: h.meta,
        })
      }
    }
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    return items
  })

  function shortTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }

  /** Bumps on every refresh start; only the latest seq may apply fetched data (avoids races). */
  let refreshSeq = 0

  export async function refresh(opts?: { background?: boolean }): Promise<void> {
    const background = opts?.background ?? false
    const mySeq = ++refreshSeq
    if (!background) {
      loading = true
      error = null
    }
    try {
      const raw = await fetchChatSessionListDeduped(fetch, CHAT_HISTORY_SIDEBAR_FETCH_LIMIT)
      if (mySeq !== refreshSeq) return

      if (!raw) {
        if (!background) {
          error = 'Could not load chats'
          sessions = []
          hasMoreChats = false
        }
        return
      }
      if (mySeq !== refreshSeq) return
      hasMoreChats = raw.length > CHAT_HISTORY_SIDEBAR_LIMIT
      sessions = raw.slice(0, CHAT_HISTORY_SIDEBAR_LIMIT)
      navHistory = await loadNavHistory()
      if (mySeq !== refreshSeq) return
    } catch (e) {
      if (mySeq !== refreshSeq) return
      if (!background) {
        error = e instanceof Error ? e.message : 'Failed to load'
        sessions = []
        hasMoreChats = false
      }
    } finally {
      if (!background) loading = false
    }
  }

  function handleItemClick(item: NavRowItem) {
    if (item.type === 'chat' && item.sessionId) {
      onSelect(item.sessionId, item.title)
    } else if (item.type === 'doc' && item.path && onSelectDoc) {
      onSelectDoc(item.path)
    } else if (item.type === 'email' && item.path && onSelectEmail) {
      onSelectEmail(item.path)
    }
  }

  function requestDelete(e: MouseEvent, item: NavRowItem) {
    e.stopPropagation()
    e.preventDefault()
    if (item.type === 'chat' && item.sessionId) {
      pendingDelete = { sessionId: item.sessionId, label: labelForDeleteChatDialog(item.title) }
    } else {
      void removeFromNavHistory(item.id)
    }
  }

  function cancelDelete() {
    pendingDelete = null
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    const id = pendingDelete.sessionId
    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) return
      pendingDelete = null
      sessions = sessions.filter((s) => s.sessionId !== id)
      emit({ type: 'chat:sessions-changed' })
      if (activeSessionId === id) onNewChat()
    } catch {
      /* ignore */
    }
  }

  onMount(() => {
    void refresh()
  })

  $effect(() => {
    return subscribe((e) => {
      if (e.type === 'chat:sessions-changed' || e.type === 'nav:recents-changed') {
        void refresh({ background: true })
      }
    })
  })
</script>

{#snippet navRow(item: NavRowItem)}
  {@const agentWorking = chatRowShowsAgentWorking(item, streamingSessionIds)}
  <div
    class={cn('ch-row', item.type === 'chat' && activeSessionId === item.sessionId && 'active')}
    role="button"
    tabindex="0"
    onclick={() => handleItemClick(item)}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleItemClick(item)
      }
    }}
  >
    {#if item.type === 'doc' && item.path}
      <span class="ch-row-doc">
        <WikiFileName path={item.path} />
      </span>
    {:else}
      <span
        class={cn(
          'ch-row-icon',
          item.type === 'chat' && 'ch-row-icon--chat',
          item.type === 'email' && 'ch-row-icon--email',
          agentWorking && 'ch-row-icon--working',
        )}
      >
        {#if item.type === 'chat'}
          {#if agentWorking}
            <Loader2 class="sync-spinning" size={12} strokeWidth={2} aria-hidden="true" />
          {:else}
            <MessageSquare size={12} strokeWidth={2} aria-hidden="true" />
          {/if}
        {:else if item.type === 'email'}
          <Mail size={12} strokeWidth={2} aria-hidden="true" />
        {/if}
      </span>
      <span class="ch-row-title">{item.title}</span>
    {/if}
    <span class="ch-row-time">{shortTime(item.timestamp)}</span>
    <button
      type="button"
      class="ch-row-delete"
      title={item.type === 'chat' ? 'Delete chat' : 'Remove from history'}
      aria-label={item.type === 'chat' ? 'Delete chat' : 'Remove from history'}
      onclick={(e) => requestDelete(e, item)}
    >
      <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>
{/snippet}

<div class="chat-history">
  <div class="ch-scroll">
    {#if loading}
      <div class="ch-muted">Loading…</div>
    {:else if error}
      <div class="ch-error">{error}</div>
    {:else}
      <section class="ch-group ch-group--chats" aria-labelledby="ch-heading-chats">
        <h2 class="ch-group-label" id="ch-heading-chats">Chats</h2>
        <button type="button" class="new-chat-btn" onclick={() => onNewChat()}>
          <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
          <span>New chat</span>
        </button>
        {#if chatItems.length === 0}
          <div class="ch-muted ch-muted--section">No chats yet.</div>
        {:else}
          <div class="ch-row-list">
            {#each chatItems as item (item.id)}
              {@render navRow(item)}
            {/each}
          </div>
          {#if hasMoreChats && onOpenAllChats}
            <button type="button" class="ch-view-all" onclick={() => onOpenAllChats()}>
              View all chats…
            </button>
          {/if}
        {/if}
      </section>

      <section class="ch-group ch-group--recents" aria-labelledby="ch-heading-recents">
        <h2 class="ch-group-label" id="ch-heading-recents">Recents</h2>
        {#if onWikiHome}
          <button type="button" class="wiki-home-btn" onclick={() => onWikiHome()}>
            <BookOpen size={14} strokeWidth={2.5} aria-hidden="true" />
            <span>Wiki home</span>
          </button>
        {/if}
        {#if recentItems.length === 0}
          <div class="ch-muted ch-muted--section">No recent documents or email.</div>
        {:else}
          <div class="ch-row-list">
            {#each recentItems as item (item.id)}
              {@render navRow(item)}
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>

  <ConfirmDialog
    open={pendingDelete !== null}
    title="Delete chat?"
    titleId="ch-delete-title"
    confirmLabel="Delete"
    cancelLabel="Cancel"
    confirmVariant="danger"
    onDismiss={cancelDelete}
    onConfirm={() => void confirmDelete()}
  >
    {#snippet children()}
      {#if pendingDelete}
        <p>This will permanently remove "{pendingDelete.label}".</p>
      {/if}
    {/snippet}
  </ConfirmDialog>
</div>

<style>
  /**
   * Same model as legacy `components/ChatHistory.svelte`: component-scoped CSS drives
   * rail padding/gaps/fonts so layout does not depend on Tailwind emitting utilities.
   */
  .chat-history {
    --ch-fs-new-chat: 0.75rem;
    --ch-fs-muted: 0.75rem;
    --ch-fs-error: 0.6875rem;
    --ch-fs-group-label: 0.625rem;
    --ch-fs-view-all: 0.6875rem;
    --ch-fs-row-title: 0.6875rem;
    --ch-fs-row-time: 0.625rem;
    --ch-lh-row-title: 1.32;
    --ch-row-pad: 6px 8px;
    --ch-row-min-h: 0;
    --ch-row-gap: 0;
    --ch-icon-w: 16px;
    --ch-wfn-icon-w: 14px;

    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding-top: 10px;
    background: var(--bg-2);
    box-sizing: border-box;
  }

  @media (max-width: 768px) {
    .chat-history {
      --ch-fs-new-chat: 0.8125rem;
      --ch-fs-muted: 0.875rem;
      --ch-fs-error: 0.75rem;
      --ch-fs-group-label: 0.6875rem;
      --ch-fs-view-all: 0.75rem;
      --ch-fs-row-title: 1.125rem;
      --ch-fs-row-time: 0.875rem;
      --ch-lh-row-title: 1.35;
      --ch-row-pad: 8px 8px;
      --ch-row-min-h: 44px;
      --ch-row-gap: 0;
      --ch-icon-w: 20px;
      --ch-wfn-icon-w: 16px;
    }
  }

  .ch-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 0 14px;
    box-sizing: border-box;
  }

  @media (max-width: 768px) {
    .ch-scroll {
      padding: 0 0 12px;
    }
  }

  .ch-muted {
    padding: 10px 2px;
    font-size: var(--ch-fs-muted);
    color: var(--text-2);
  }

  .ch-muted--section {
    padding: 6px 2px 8px;
    font-style: italic;
  }

  .ch-error {
    padding: 10px 2px;
    font-size: var(--ch-fs-error);
    color: var(--danger);
  }

  .ch-group {
    margin: 0;
  }

  .ch-group--chats {
    margin-top: 2px;
    padding-bottom: 20px;
  }

  .ch-group--recents {
    margin-top: 4px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
  }

  .ch-group-label {
    margin: 0;
    font-size: var(--ch-fs-group-label);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-2);
    padding: 2px 2px 8px;
  }

  .new-chat-btn,
  .wiki-home-btn {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    box-sizing: border-box;
    width: 100%;
    margin: 0 0 8px;
    padding: 7px 10px;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--text);
    font-size: var(--ch-fs-new-chat);
    font-weight: 500;
    transition: background 0.12s;
    cursor: pointer;
  }

  .ch-view-all {
    display: block;
    width: 100%;
    margin: 6px 0 0;
    padding: 6px 8px;
    border-radius: 0.375rem;
border: 1px dashed var(--border);
    background: transparent;
    color: var(--accent);
    font-size: var(--ch-fs-view-all);
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
    box-sizing: border-box;
  }

  .ch-view-all:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .ch-row-list {
    display: flex;
    flex-direction: column;
    gap: var(--ch-row-gap);
  }

  .ch-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    min-height: var(--ch-row-min-h);
    padding: var(--ch-row-pad);
    box-sizing: border-box;
    margin: 0;
    color: var(--text);
    cursor: pointer;
    transition: background 0.12s;
  }

  .ch-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .ch-row.active {
    background: var(--accent-dim);
    outline: 1px solid var(--accent);
  }

  .ch-row-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--ch-icon-w);
    color: var(--text-2);
    opacity: 0.6;
  }

  .ch-row-icon--chat {
    color: var(--accent);
    opacity: 0.75;
  }

  .ch-row-icon--working {
    opacity: 0.9;
  }

  .ch-row-icon--email {
    color: var(--text-2);
    opacity: 0.65;
  }

  .ch-row-doc {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .ch-row-doc :global(.wfn-title-row) {
    font-size: var(--ch-fs-row-title);
    line-height: var(--ch-lh-row-title);
  }

  .ch-row-doc :global(.wfn-lead-icon) {
    width: var(--ch-wfn-icon-w);
  }

  .ch-row-doc :global(.wfn-name) {
    color: var(--text);
  }

  .ch-row-title {
    flex: 1;
    min-width: 0;
    font-size: var(--ch-fs-row-title);
    line-height: var(--ch-lh-row-title);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ch-row-time {
    margin-inline-start: 2px;
    margin-inline-end: 6px;
    font-size: var(--ch-fs-row-time);
    color: var(--text-2);
    flex-shrink: 0;
    opacity: 0.7;
  }

  .ch-row-delete {
    flex-shrink: 0;
    padding: 3px;
    border: none;
background: transparent;
    color: var(--text-2);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s, background 0.12s;
  }

  @media (hover: none) {
    .ch-row-delete {
      opacity: 1;
    }
  }

  @media (hover: hover) {
    .new-chat-btn:hover,
    .wiki-home-btn:hover {
      background: var(--bg-3);
    }

    .ch-view-all:hover {
      background: var(--bg-3);
      border-color: var(--text-2);
    }

    .ch-row:hover {
      background: var(--bg-3);
    }

    .ch-row:hover .ch-row-doc :global(.wfn-name) {
      color: var(--accent);
    }

    .ch-row:hover .ch-row-delete {
      opacity: 0.45;
    }

    .ch-row-delete:hover {
      opacity: 1 !important;
      color: var(--danger);
      background: rgba(224, 92, 92, 0.12);
    }
  }
</style>
