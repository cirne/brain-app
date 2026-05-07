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
  import {
    chatHistoryRailEmptyMutedClass,
    chatHistoryRailPrimaryBtn,
    chatHistoryRailViewAllBtn,
    chatHistoryRowListClass,
  } from '@components/chatHistoryRail.js'
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
    console.log('[effect-debug]', 'src/client/components/ChatHistory.svelte', '#1')
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
    class={cn(
      'ch-row group/chrow box-border m-0 flex w-full cursor-pointer items-center gap-1.5 px-1.5 py-1 text-left text-foreground transition-colors max-md:min-h-11 max-md:px-1.5 max-md:py-1.5',
      'hover:bg-surface-3 hover:[&_.wfn-name]:text-accent',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:[outline-offset:1px]',
      item.type === 'chat' && activeSessionId === item.sessionId && 'active bg-accent-dim outline outline-1 outline-accent',
    )}
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
      <span
        class="ch-row-doc flex-1 min-w-0 overflow-hidden [&_.wfn-name]:text-foreground [&_.wfn-lead-icon]:w-3.5 max-md:[&_.wfn-lead-icon]:w-4 [&_.wfn-title-row]:text-[11px] [&_.wfn-title-row]:leading-[1.32] max-md:[&_.wfn-title-row]:text-lg max-md:[&_.wfn-title-row]:leading-[1.35]"
      >
        <WikiFileName path={item.path} />
      </span>
    {:else}
      <span
        class={cn(
          'flex size-4 shrink-0 items-center justify-center max-md:size-5',
          item.type === 'chat' && 'text-accent',
          item.type === 'email' && 'text-muted/65',
          item.type === 'chat' && (agentWorking ? 'opacity-90' : 'opacity-75'),
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
      <span
        class="ch-row-title min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[1.32] max-md:text-lg max-md:leading-[1.35]"
      >{item.title}</span>
    {/if}
    <span class="ch-row-time ms-0.5 me-1.5 shrink-0 text-[10px] text-muted/70 max-md:text-sm"
      >{shortTime(item.timestamp)}</span>
    <button
      type="button"
      class="ch-row-delete shrink-0 p-[3px] text-muted opacity-0 transition-[opacity,color,background] [@media(hover:none)]:opacity-100 group-hover/chrow:opacity-45 hover:!opacity-100 hover:!text-danger hover:!bg-[rgba(224,92,92,0.12)]"
      title={item.type === 'chat' ? 'Delete chat' : 'Remove from history'}
      aria-label={item.type === 'chat' ? 'Delete chat' : 'Remove from history'}
      onclick={(e) => requestDelete(e, item)}
    >
      <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
    </button>
  </div>
{/snippet}

<div class="chat-history box-border flex h-full min-h-0 flex-col bg-surface-2 pt-2.5">
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3.5 max-md:pb-3">
    {#if loading}
      <div class="ch-muted px-0.5 py-2.5 text-xs text-muted max-md:text-sm">Loading…</div>
    {:else if error}
      <div class="ch-error px-0.5 py-2.5 text-[11px] text-danger max-md:text-xs">{error}</div>
    {:else}
      <section
        class="ch-group ch-group--chats m-0 mt-0.5 flex min-w-0 w-full max-w-full flex-col pb-5"
        aria-labelledby="ch-heading-chats"
      >
        <h2
          class="ch-group-label m-0 px-2 pb-2 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted max-md:text-[11px]"
          id="ch-heading-chats"
        >
          Chats
        </h2>
        <button
          type="button"
          class={cn(chatHistoryRailPrimaryBtn, 'new-chat-btn border-0 hover:border-transparent')}
          onclick={() => onNewChat()}
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
          <span>New chat</span>
        </button>
        {#if chatItems.length === 0}
          <div class={cn(chatHistoryRailEmptyMutedClass, 'ch-muted--section')}>No chats yet.</div>
        {:else}
          <div class={chatHistoryRowListClass}>
            {#each chatItems as item (item.id)}
              {@render navRow(item)}
            {/each}
          </div>
          {#if hasMoreChats && onOpenAllChats}
            <button type="button" class={cn(chatHistoryRailViewAllBtn, 'ch-view-all')} onclick={() => onOpenAllChats()}>
              View all chats…
            </button>
          {/if}
        {/if}
      </section>

      <section
        class="ch-group ch-group--recents m-0 mt-1 flex min-w-0 w-full max-w-full flex-col border-t border-border pt-3.5"
        aria-labelledby="ch-heading-recents"
      >
        <h2
          class="ch-group-label m-0 px-2 pb-2 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted max-md:text-[11px]"
          id="ch-heading-recents"
        >
          Recents
        </h2>
        {#if onWikiHome}
          <button
            type="button"
            class={cn(chatHistoryRailPrimaryBtn, 'wiki-home-btn border-0 hover:border-transparent')}
            onclick={() => onWikiHome()}
          >
            <BookOpen size={14} strokeWidth={2.5} aria-hidden="true" />
            <span>Wiki home</span>
          </button>
        {/if}
        {#if recentItems.length === 0}
          <div class={cn(chatHistoryRailEmptyMutedClass, 'ch-muted--section')}>
            No recent documents or email.
          </div>
        {:else}
          <div class={chatHistoryRowListClass}>
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
