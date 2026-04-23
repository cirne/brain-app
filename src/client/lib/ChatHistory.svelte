<script lang="ts">
  import { onMount } from 'svelte'
  import { subscribe } from './app/appEvents.js'
  import { Loader2, MessageSquare, Mail, Trash2, Plus } from 'lucide-svelte'
  import { chatRowShowsAgentWorking } from './chatHistoryStreamingIndicator.js'
  import { labelForDeleteChatDialog } from './chatHistoryDelete.js'
  import {
    fetchChatSessionsWith401Retry,
    formatChatSessionsFetchError,
  } from './chatHistorySessions.js'
  import {
    loadNavHistory,
    removeFromNavHistory,
    type NavHistoryItem,
  } from './navHistory.js'
  import WikiFileName from './WikiFileName.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'

  const emptyStreamingIds = new Set<string>()

  export type ChatSessionListItem = {
    sessionId: string
    createdAt: string
    updatedAt: string
    title: string | null
    preview?: string
  }

  let {
    activeSessionId = null as string | null,
    /** Server session ids with an in-flight agent response (SSE), including background tabs. */
    streamingSessionIds = emptyStreamingIds,
    onSelect,
    onSelectDoc,
    onSelectEmail,
    onNewChat,
  }: {
    activeSessionId?: string | null
    streamingSessionIds?: ReadonlySet<string>
    onSelect: (_sessionId: string) => void
    onSelectDoc?: (_path: string) => void
    onSelectEmail?: (_id: string) => void
    onNewChat: () => void
  } = $props()

  let sessions = $state<ChatSessionListItem[]>([])
  let navHistory = $state<NavHistoryItem[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let pendingDelete = $state<{ sessionId: string; label: string } | null>(null)

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
      const res = await fetchChatSessionsWith401Retry(fetch)
      if (mySeq !== refreshSeq) return

      if (!res) {
        if (!background) {
          error = 'Could not load chats'
          sessions = []
        }
        return
      }
      if (!res.ok) {
        if (!background) {
          error = formatChatSessionsFetchError(res)
          sessions = []
        }
        return
      }
      const nextSessions = (await res.json()) as ChatSessionListItem[]
      if (mySeq !== refreshSeq) return
      sessions = nextSessions
      navHistory = await loadNavHistory()
      if (mySeq !== refreshSeq) return
    } catch (e) {
      if (mySeq !== refreshSeq) return
      if (!background) {
        error = e instanceof Error ? e.message : 'Failed to load'
        sessions = []
      }
    } finally {
      if (!background) loading = false
    }
  }

  function handleItemClick(item: NavRowItem) {
    if (item.type === 'chat' && item.sessionId) {
      onSelect(item.sessionId)
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
    class="ch-row"
    class:active={item.type === 'chat' && activeSessionId === item.sessionId}
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
        class="ch-row-icon"
        class:ch-row-icon--chat={item.type === 'chat'}
        class:ch-row-icon--email={item.type === 'email'}
        class:ch-row-icon--working={agentWorking}
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
  <button type="button" class="new-chat-btn" onclick={() => onNewChat()}>
    <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
    <span>New chat</span>
  </button>

  <div class="ch-scroll">
    {#if loading}
      <div class="ch-muted">Loading…</div>
    {:else if error}
      <div class="ch-error">{error}</div>
    {:else}
      <div class="ch-group">
        <div class="ch-group-label">Chats</div>
        {#if chatItems.length === 0}
          <div class="ch-muted ch-muted--section">No chats yet.</div>
        {:else}
          {#each chatItems as item (item.id)}
            {@render navRow(item)}
          {/each}
        {/if}
      </div>

      <div class="ch-group ch-group--recents">
        <div class="ch-group-label">Recents</div>
        {#if recentItems.length === 0}
          <div class="ch-muted ch-muted--section">No recent documents or email.</div>
        {:else}
          {#each recentItems as item (item.id)}
            {@render navRow(item)}
          {/each}
        {/if}
      </div>
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
  .chat-history {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding-top: 8px;
    background: var(--bg-2);
  }

  .new-chat-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 10px;
    padding: 7px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-3);
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
    transition: background 0.15s, border-color 0.15s;
  }
  .new-chat-btn:hover {
    background: var(--bg);
    border-color: var(--text-2);
  }

  .ch-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 6px 10px;
  }

  .ch-muted {
    padding: 10px;
    font-size: 12px;
    color: var(--text-2);
  }

  .ch-muted--section {
    padding: 6px 6px 8px;
    font-style: italic;
  }

  .ch-error {
    padding: 10px;
    font-size: 11px;
    color: var(--danger);
  }

  .ch-group {
    margin-top: 6px;
  }

  .ch-group:first-child {
    margin-top: 2px;
  }

  .ch-group--recents {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }

  .ch-group-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
    padding: 2px 6px 6px;
  }

  .ch-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    padding: 5px 6px;
    border-radius: 6px;
    margin-bottom: 1px;
    color: var(--text);
    cursor: pointer;
    transition: background 0.12s;
  }
  .ch-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .ch-row:hover {
    background: var(--bg-3);
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
    width: 16px;
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
    font-size: 12px;
  }

  .ch-row-doc :global(.wfn-lead-icon) {
    width: 14px;
  }

  .ch-row-doc :global(.wfn-name) {
    color: var(--text);
  }

  .ch-row:hover .ch-row-doc :global(.wfn-name) {
    color: var(--accent);
  }

  .ch-row-title {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ch-row-time {
    font-size: 10px;
    color: var(--text-2);
    flex-shrink: 0;
    opacity: 0.7;
  }

  .ch-row-delete {
    flex-shrink: 0;
    padding: 3px;
    border-radius: 4px;
    color: var(--text-2);
    opacity: 0;
    transition: opacity 0.12s, color 0.12s, background 0.12s;
  }
  .ch-row:hover .ch-row-delete {
    opacity: 1;
  }
  .ch-row-delete:hover {
    color: var(--danger);
    background: rgba(224, 92, 92, 0.12);
  }
</style>
