<script lang="ts">
  import { onMount } from 'svelte'
  import { MessageSquarePlus, Pin, PinOff, Trash2, X } from 'lucide-svelte'
  import {
    CHAT_HISTORY_GROUP_LABEL,
    CHAT_HISTORY_GROUP_ORDER,
    type ChatHistoryGroupKey,
    groupKeyForUpdatedAt,
  } from './chatHistoryGroups.js'

  export type ChatSessionListItem = {
    sessionId: string
    createdAt: string
    updatedAt: string
    title: string | null
    preview?: string
  }

  let {
    activeSessionId = null as string | null,
    desktop = false,
    pinned = false,
    onSelect,
    onNewChat,
    onClose,
    onTogglePin,
  }: {
    activeSessionId?: string | null
    desktop?: boolean
    pinned?: boolean
    onSelect: (_sessionId: string) => void
    onNewChat: () => void
    onClose: () => void
    onTogglePin?: () => void
  } = $props()

  let sessions = $state<ChatSessionListItem[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)

  const grouped = $derived.by(() => {
    const order = CHAT_HISTORY_GROUP_ORDER
    const buckets = new Map<ChatHistoryGroupKey, ChatSessionListItem[]>()
    for (const k of order) buckets.set(k, [])
    for (const s of sessions) {
      const k = groupKeyForUpdatedAt(s.updatedAt)
      buckets.get(k)!.push(s)
    }
    return order.filter((k) => (buckets.get(k)?.length ?? 0) > 0).map((k) => ({
      key: k,
      label: CHAT_HISTORY_GROUP_LABEL[k],
      items: buckets.get(k)!,
    }))
  })

  function rowLabel(s: ChatSessionListItem): string {
    if (s.title?.trim()) return s.title.trim()
    if (s.preview?.trim()) return s.preview.trim()
    return 'New chat'
  }

  function shortTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }

  export async function refresh(): Promise<void> {
    loading = true
    error = null
    try {
      const res = await fetch('/api/chat/sessions')
      if (!res.ok) {
        error = `${res.status} ${res.statusText}`
        sessions = []
        return
      }
      sessions = await res.json()
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load'
      sessions = []
    } finally {
      loading = false
    }
  }

  async function removeSession(e: MouseEvent, id: string) {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) return
      sessions = sessions.filter((s) => s.sessionId !== id)
      if (activeSessionId === id) onNewChat()
    } catch { /* ignore */ }
  }

  onMount(() => {
    void refresh()
  })
</script>

<div class="chat-history">
  <div class="ch-head">
    <span class="ch-title">Chats</span>
    <div class="ch-head-actions">
      {#if desktop && onTogglePin}
        <button
          type="button"
          class="icon-btn"
          onclick={onTogglePin}
          title={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
          aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
        >
          {#if pinned}
            <PinOff size={16} strokeWidth={2} aria-hidden="true" />
          {:else}
            <Pin size={16} strokeWidth={2} aria-hidden="true" />
          {/if}
        </button>
      {/if}
      <button type="button" class="icon-btn" onclick={onClose} title="Close" aria-label="Close sidebar">
        <X size={18} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  </div>

  <button type="button" class="new-chat-btn" onclick={() => onNewChat()}>
    <MessageSquarePlus size={16} strokeWidth={2} aria-hidden="true" />
    <span>New chat</span>
  </button>

  <div class="ch-scroll">
    {#if loading}
      <div class="ch-muted">Loading…</div>
    {:else if error}
      <div class="ch-error">{error}</div>
    {:else if sessions.length === 0}
      <div class="ch-muted">No saved chats yet.</div>
    {:else}
      {#each grouped as g (g.key)}
        <div class="ch-group">
          <div class="ch-group-label">{g.label}</div>
          {#each g.items as s (s.sessionId)}
            <div
              class="ch-row"
              class:active={activeSessionId === s.sessionId}
              role="button"
              tabindex="0"
              onclick={() => onSelect(s.sessionId)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(s.sessionId)
                }
              }}
            >
              <div class="ch-row-main">
                <span class="ch-row-title">{rowLabel(s)}</span>
                <span class="ch-row-time">{shortTime(s.updatedAt)}</span>
              </div>
              <button
                type="button"
                class="ch-row-delete"
                title="Delete chat"
                aria-label="Delete chat"
                onclick={(e) => removeSession(e, s.sessionId)}
              >
                <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .chat-history {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-2);
  }

  .ch-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .ch-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.02em;
  }

  .ch-head-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    color: var(--text-2);
    transition: color 0.15s, background 0.15s;
  }
  .icon-btn:hover {
    color: var(--text);
    background: var(--bg-3);
  }

  .new-chat-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 12px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-3);
    color: var(--text);
    font-size: 13px;
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
    padding: 0 8px 12px;
  }

  .ch-muted {
    padding: 12px;
    font-size: 13px;
    color: var(--text-2);
  }

  .ch-error {
    padding: 12px;
    font-size: 12px;
    color: var(--danger);
  }

  .ch-group {
    margin-top: 12px;
  }
  .ch-group:first-child {
    margin-top: 4px;
  }

  .ch-group-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
    padding: 4px 8px 6px;
  }

  .ch-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    width: 100%;
    text-align: left;
    padding: 8px 8px;
    border-radius: 8px;
    margin-bottom: 2px;
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

  .ch-row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ch-row-title {
    font-size: 13px;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .ch-row-time {
    font-size: 11px;
    color: var(--text-2);
    flex-shrink: 0;
  }

  .ch-row-delete {
    flex-shrink: 0;
    padding: 4px;
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
