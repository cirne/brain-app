<script lang="ts">
  import { onMount } from 'svelte'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { Loader2, MessageSquare, Search, Trash2 } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import { chatRowShowsAgentWorking } from '@client/lib/chatHistoryStreamingIndicator.js'
  import { labelForDeleteChatDialog } from '@client/lib/chatHistoryDelete.js'
  import {
    CHAT_HISTORY_PAGE_LIST_LIMIT,
    fetchChatSessionsWith401Retry,
    formatChatSessionsFetchError,
  } from '@client/lib/chatHistorySessions.js'
  import type { ChatSessionListItem } from '@client/lib/chatSessionTypes.js'
  import ConfirmDialog from '@components/ConfirmDialog.svelte'

  const emptyStreaming = new Set<string>()

  let {
    activeSessionId = null as string | null,
    streamingSessionIds = emptyStreaming,
    onSelectSession,
    onNewChat,
  }: {
    activeSessionId?: string | null
    streamingSessionIds?: ReadonlySet<string>
    onSelectSession: (_sessionId: string, _title?: string) => void
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

  function rowClick(id: string, title?: string) {
    onSelectSession(id, title)
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

<div class="chp flex h-full min-h-0 flex-col bg-surface-2">
  <div class="chp-search shrink-0 px-3 pt-2.5 pb-2 border-b border-border">
    <label class="chp-search-label block mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted" for="chp-search-input">Search chats</label>
    <div class="chp-search-inner flex items-center gap-2 px-2.5 py-2 border border-border bg-surface-3">
      <Search class="chp-search-icon" size={16} strokeWidth={2} aria-hidden="true" />
      <input
        id="chp-search-input"
        type="search"
        class="chp-input flex-1 min-w-0 border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted placeholder:opacity-70"
        placeholder="Filter"
        bind:value={searchQuery}
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  </div>

  <div class="chp-list flex-1 min-h-0 overflow-y-auto px-2 pt-1.5 pb-3">
    {#if loading}
      <div class="chp-muted px-2 py-3 text-[13px] text-muted">Loading…</div>
    {:else if error}
      <div class="chp-error chp-muted px-2 py-3 text-[13px] text-danger">{error}</div>
    {:else if sessions.length === 0}
      <div class="chp-muted px-2 py-3 text-[13px] text-muted">No chats yet.</div>
    {:else if filtered.length === 0}
      <div class="chp-muted px-2 py-3 text-[13px] text-muted">No chats match your search.</div>
    {:else}
      {#each filtered as s (s.sessionId)}
        {@const agentWorking = chatRowShowsAgentWorking(
          { type: 'chat' as const, sessionId: s.sessionId },
          streamingSessionIds,
        )}
        <div
          class={cn(
            'chp-row group/chprow flex w-full items-start gap-2 px-2 py-[9px] mb-0.5 text-left text-foreground cursor-pointer transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:[outline-offset:1px]',
            activeSessionId === s.sessionId && 'active bg-accent-dim outline outline-1 outline-accent',
          )}
          role="button"
          tabindex="0"
          onclick={() => rowClick(s.sessionId, s.title ?? undefined)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              rowClick(s.sessionId, s.title ?? undefined)
            }
          }}
        >
          <span
            class={cn(
              'chp-row-icon flex shrink-0 items-center justify-center w-[18px] h-[18px] mt-px text-accent opacity-80',
              agentWorking && 'chp-row-icon--working opacity-95',
            )}
            aria-hidden="true"
          >
            {#if agentWorking}
              <Loader2 class="sync-spinning" size={14} strokeWidth={2} />
            {:else}
              <MessageSquare size={14} strokeWidth={2} />
            {/if}
          </span>
          <div class="chp-row-main flex-1 min-w-0">
            <div class="chp-row-title text-[13px] leading-snug font-medium overflow-hidden text-ellipsis [-webkit-line-clamp:2] [-webkit-box-orient:vertical] [display:-webkit-box]">
              {s.title?.trim() || s.preview?.trim() || 'New chat'}
            </div>
            {#if s.preview?.trim() && s.title?.trim() && s.preview.trim() !== s.title.trim()}
              <div class="chp-row-preview mt-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted">{s.preview}</div>
            {/if}
          </div>
          <time class="chp-row-time shrink-0 mt-px text-[11px] text-muted opacity-80 whitespace-nowrap" datetime={s.updatedAt}>{formatWhen(s.updatedAt)}</time>
          <button
            type="button"
            class="chp-row-delete shrink-0 p-1 text-muted opacity-0 transition-[opacity,color,background] [@media(hover:none)]:opacity-100 group-hover/chprow:opacity-100 hover:!text-danger hover:!bg-[rgba(224,92,92,0.12)]"
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
  /* Search icon is rendered via the lucide `class` prop, so it lands outside the scoped CSS scope.
     Keep it as a `:global` rule so the visual styling matches the legacy component. */
  :global(.chp-search-icon) {
    flex-shrink: 0;
    color: var(--text-2);
    opacity: 0.75;
  }
</style>
