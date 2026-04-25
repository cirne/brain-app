<script lang="ts">
  import { onMount } from 'svelte'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { Loader2, MessageSquare, Search, Trash2 } from 'lucide-svelte'
  import { chatRowShowsAgentWorking } from '@client/lib/chatHistoryStreamingIndicator.js'
  import { labelForDeleteChatDialog } from '@client/lib/chatHistoryDelete.js'
  import {
    CHAT_HISTORY_PAGE_LIST_LIMIT,
    fetchChatSessionsWith401Retry,
    formatChatSessionsFetchError,
  } from '@client/lib/chatHistorySessions.js'
  import type { ChatSessionListItem } from '@client/lib/chatSessionTypes.js'
  import ConfirmDialog from './ConfirmDialog.svelte'

  const emptyStreaming = new Set<string>()

  let {
    activeSessionId = null as string | null,
    streamingSessionIds = emptyStreaming,
    onSelectSession,
    onNewChat,
  }: {
    activeSessionId?: string | null
    streamingSessionIds?: ReadonlySet<string>
    onSelectSession: (_sessionId: string) => void
    onNewChat: () => void
  } = $props()

  let sessions = $state<ChatSessionListItem[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let searchQuery = $state('')
  let pendingDelete = $state<{ sessionId: string; label: string } | null>(null)

  const filtered = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => {
      const title = (s.title ?? '').toLowerCase()
      const preview = (s.preview ?? '').toLowerCase()
      return (
        title.includes(q) || preview.includes(q) || s.sessionId.toLowerCase().includes(q)
      )
    })
  })

  function formatWhen(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  let refreshSeq = 0

  async function load(opts?: { background?: boolean }): Promise<void> {
    const background = opts?.background ?? false
    const mySeq = ++refreshSeq
    if (!background) {
      loading = true
      error = null
    }
    try {
      const res = await fetchChatSessionsWith401Retry(
        fetch,
        undefined,
        CHAT_HISTORY_PAGE_LIST_LIMIT,
      )
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
      const next = (await res.json()) as ChatSessionListItem[]
      if (mySeq !== refreshSeq) return
      sessions = next
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

  function rowClick(id: string) {
    onSelectSession(id)
  }

  function requestDelete(e: MouseEvent, s: ChatSessionListItem) {
    e.stopPropagation()
    e.preventDefault()
    const label = s.title?.trim() || s.preview?.trim() || 'New chat'
    pendingDelete = { sessionId: s.sessionId, label: labelForDeleteChatDialog(label) }
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
    void load()
  })

  $effect(() => {
    return subscribe((e) => {
      if (e.type === 'chat:sessions-changed') {
        void load({ background: true })
      }
    })
  })
</script>

<div class="chp">
  <div class="chp-search">
    <label class="chp-search-label" for="chp-search-input">Search chats</label>
    <div class="chp-search-inner">
      <Search class="chp-search-icon" size={16} strokeWidth={2} aria-hidden="true" />
      <input
        id="chp-search-input"
        type="search"
        class="chp-input"
        placeholder="Filter"
        bind:value={searchQuery}
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  </div>

  <div class="chp-list">
    {#if loading}
      <div class="chp-muted">Loading…</div>
    {:else if error}
      <div class="chp-error">{error}</div>
    {:else if sessions.length === 0}
      <div class="chp-muted">No chats yet.</div>
    {:else if filtered.length === 0}
      <div class="chp-muted">No chats match your search.</div>
    {:else}
      {#each filtered as s (s.sessionId)}
        {@const agentWorking = chatRowShowsAgentWorking(
          { type: 'chat' as const, sessionId: s.sessionId },
          streamingSessionIds,
        )}
        <div
          class="chp-row"
          class:active={activeSessionId === s.sessionId}
          role="button"
          tabindex="0"
          onclick={() => rowClick(s.sessionId)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              rowClick(s.sessionId)
            }
          }}
        >
          <span
            class="chp-row-icon"
            class:chp-row-icon--working={agentWorking}
            aria-hidden="true"
          >
            {#if agentWorking}
              <Loader2 class="sync-spinning" size={14} strokeWidth={2} />
            {:else}
              <MessageSquare size={14} strokeWidth={2} />
            {/if}
          </span>
          <div class="chp-row-main">
            <div class="chp-row-title">
              {s.title?.trim() || s.preview?.trim() || 'New chat'}
            </div>
            {#if s.preview?.trim() && s.title?.trim() && s.preview.trim() !== s.title.trim()}
              <div class="chp-row-preview">{s.preview}</div>
            {/if}
          </div>
          <time class="chp-row-time" datetime={s.updatedAt}>{formatWhen(s.updatedAt)}</time>
          <button
            type="button"
            class="chp-row-delete"
            title="Delete chat"
            aria-label="Delete chat"
            onclick={(e) => requestDelete(e, s)}
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      {/each}
    {/if}
  </div>

  <ConfirmDialog
    open={pendingDelete !== null}
    title="Delete chat?"
    titleId="chp-delete-title"
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
  .chp {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-2);
  }

  .chp-search {
    flex-shrink: 0;
    padding: 10px 12px 8px;
    border-bottom: 1px solid var(--border);
  }

  .chp-search-label {
    display: block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
    margin-bottom: 6px;
  }

  .chp-search-inner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-3);
  }

  :global(.chp-search-icon) {
    flex-shrink: 0;
    color: var(--text-2);
    opacity: 0.75;
  }

  .chp-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    outline: none;
  }
  .chp-input::placeholder {
    color: var(--text-2);
    opacity: 0.7;
  }

  .chp-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 8px 12px;
  }

  .chp-muted,
  .chp-error {
    padding: 12px 8px;
    font-size: 13px;
    color: var(--text-2);
  }
  .chp-error {
    color: var(--danger);
  }

  .chp-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 9px 8px;
    border-radius: 8px;
    margin-bottom: 2px;
    color: var(--text);
    cursor: pointer;
    transition: background 0.12s;
  }
  .chp-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .chp-row.active {
    background: var(--accent-dim);
    outline: 1px solid var(--accent);
  }

  .chp-row-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    color: var(--accent);
    opacity: 0.8;
  }
  .chp-row-icon--working {
    opacity: 0.95;
  }

  .chp-row-main {
    flex: 1;
    min-width: 0;
  }
  .chp-row-title {
    font-size: 13px;
    line-height: 1.35;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .chp-row-preview {
    font-size: 11px;
    color: var(--text-2);
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chp-row-time {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-2);
    opacity: 0.8;
    white-space: nowrap;
    margin-top: 1px;
  }
  .chp-row-delete {
    flex-shrink: 0;
    padding: 4px;
    border-radius: 4px;
    color: var(--text-2);
    opacity: 0;
    transition: opacity 0.12s, color 0.12s, background 0.12s;
  }

  @media (hover: none) {
    .chp-row-delete {
      opacity: 1;
    }
  }

  @media (hover: hover) {
    .chp-row:hover {
      background: var(--bg-3);
    }

    .chp-row:hover .chp-row-delete {
      opacity: 1;
    }

    .chp-row-delete:hover {
      color: var(--danger);
      background: rgba(224, 92, 92, 0.12);
    }
  }
</style>
