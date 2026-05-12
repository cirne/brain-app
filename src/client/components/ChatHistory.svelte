<script lang="ts">
  import { onMount } from 'svelte'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { t } from '@client/lib/i18n/index.js'
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { BookOpen, Loader2, MessageSquare, Trash2, Plus, Link2, Bell } from 'lucide-svelte'
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
  import type { ApprovalState, ChatSessionListItem, ChatSessionType } from '@client/lib/chatSessionTypes.js'

  const emptyStreamingIds = new Set<string>()

  let {
    activeSessionId = null as string | null,
    /** Server session ids with an in-flight agent response (SSE), including background tabs. */
    streamingSessionIds = emptyStreamingIds,
    onSelect,
    onSelectDoc,
    onNewChat,
    onOpenAllChats,
    onWikiHome,
  }: {
    activeSessionId?: string | null
    streamingSessionIds?: ReadonlySet<string>
    onSelect: (_sessionId: string, _title?: string) => void
    onSelectDoc?: (_path: string) => void
    onNewChat: () => void
    onOpenAllChats?: () => void
    onWikiHome?: () => void
  } = $props()

  let sessions = $state<ChatSessionListItem[]>([])
  let tunnels = $state<B2BTunnelRow[]>([])
  let tunnelsError = $state<string | null>(null)
  let navHistory = $state<NavHistoryItem[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let pendingDelete = $state<{ sessionId: string; label: string } | null>(null)
  let hasMoreChats = $state(false)

  type NavRowItem = {
    id: string
    type: 'chat' | 'doc' | 'tunnel'
    title: string
    timestamp: string
    path?: string
    meta?: string
    sessionId?: string
    /** Outbound tunnel row: grant backing this tunnel (used to open/create session). */
    tunnelGrantId?: string
    /** Tunnel rows omit the trailing time column. */
    omitRowTime?: boolean
    sessionType?: ChatSessionType
    approvalState?: ApprovalState | null
    badgeLabel?: string
  }

  type B2BTunnelRow = {
    grantId: string
    ownerId: string
    ownerHandle: string
    ownerDisplayName: string
    sessionId: string | null
  }

  function tunnelSidebarLabel(t: B2BTunnelRow): string {
    return (
      (t.ownerDisplayName?.trim() || t.ownerHandle?.trim() || t.grantId || '').trim() || t.grantId
    )
  }

  function fallbackChatTitle(s: ChatSessionListItem): string {
    return s.title?.trim() || s.preview?.trim() || $t('chat.history.newChatFallbackTitle')
  }

  function remoteLabel(s: ChatSessionListItem): string | null {
    return s.remoteDisplayName?.trim() || s.remoteHandle?.trim() || null
  }

  function chatItemTitle(s: ChatSessionListItem): string {
    if (s.sessionType === 'b2b_outbound') {
      return remoteLabel(s) || fallbackChatTitle(s)
    }
    if (s.sessionType === 'b2b_inbound') {
      return remoteLabel(s) || fallbackChatTitle(s)
    }
    return fallbackChatTitle(s)
  }

  function toChatItem(s: ChatSessionListItem): NavRowItem {
    return {
      id: `chat:${s.sessionId}`,
      type: 'chat' as const,
      title: chatItemTitle(s),
      timestamp: s.updatedAt,
      sessionId: s.sessionId,
      sessionType: s.sessionType,
      approvalState: s.approvalState,
      badgeLabel:
        s.sessionType === 'b2b_inbound' && s.approvalState === 'pending'
          ? $t('chat.history.pendingBadge')
          : undefined,
    }
  }

  function sortedChatItems(items: ChatSessionListItem[]): NavRowItem[] {
    const mapped = items.map(toChatItem)
    mapped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    return mapped
  }

  const chatItems = $derived.by(() => sortedChatItems(sessions.filter((s) => s.sessionType === 'own')))

  const tunnelNavRows = $derived.by((): NavRowItem[] => {
    const mapped = tunnels.map((t) => ({
      id: `tunnel:${t.grantId}`,
      type: 'tunnel' as const,
      title: tunnelSidebarLabel(t),
      timestamp: '',
      omitRowTime: true,
      tunnelGrantId: t.grantId,
      sessionId: t.sessionId ?? undefined,
    }))
    mapped.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    return mapped
  })

  const inboundItems = $derived.by(() =>
    sortedChatItems(sessions.filter((s) => s.sessionType === 'b2b_inbound')),
  )

  const pendingInboundCount = $derived(
    sessions.filter((s) => s.sessionType === 'b2b_inbound' && s.approvalState === 'pending').length,
  )

  /** Wiki pages from nav history (docs only; email threads stay out of this rail section). */
  const wikiNavItems = $derived.by(() => {
    const items: NavRowItem[] = []
    for (const h of navHistory) {
      if (h.type === 'doc' && h.path) {
        items.push({
          id: h.id,
          type: 'doc' as const,
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
      const raw = await fetchChatSessionListDeduped(CHAT_HISTORY_SIDEBAR_FETCH_LIMIT)
      if (mySeq !== refreshSeq) return

      if (!raw) {
        if (!background) {
          error = $t('chat.history.loadFailed')
          sessions = []
          tunnels = []
          tunnelsError = null
          hasMoreChats = false
        }
        return
      }
      if (mySeq !== refreshSeq) return
      hasMoreChats = raw.length > CHAT_HISTORY_SIDEBAR_LIMIT
      sessions = raw.slice(0, CHAT_HISTORY_SIDEBAR_LIMIT)

      tunnelsError = null
      try {
        const tunnelRes = await apiFetch('/api/chat/b2b/tunnels')
        if (mySeq !== refreshSeq) return
        if (tunnelRes.ok) {
          const body = (await tunnelRes.json()) as { tunnels?: unknown }
          const list = body.tunnels
          tunnels =
            Array.isArray(list)
              ? (list as B2BTunnelRow[]).filter(
                  (r) =>
                    typeof r.grantId === 'string' &&
                    typeof r.ownerId === 'string' &&
                    typeof r.ownerHandle === 'string' &&
                    typeof r.ownerDisplayName === 'string' &&
                    (r.sessionId === null || typeof r.sessionId === 'string'),
                )
              : []
        } else {
          tunnels = []
          if (tunnelRes.status !== 404) {
            tunnelsError = $t('chat.history.tunnelsLoadFailed')
          }
        }
      } catch {
        if (mySeq !== refreshSeq) return
        tunnels = []
        tunnelsError = $t('chat.history.tunnelsLoadFailed')
      }

      navHistory = await loadNavHistory()
      if (mySeq !== refreshSeq) return
    } catch (e) {
      if (mySeq !== refreshSeq) return
      if (!background) {
        error = e instanceof Error ? e.message : $t('chat.history.loadFailedGeneric')
        sessions = []
        tunnels = []
        tunnelsError = null
        hasMoreChats = false
      }
    } finally {
      if (!background) loading = false
    }
  }

  async function ensureTunnelOutboundSession(grantId: string): Promise<string | null> {
    const res = await apiFetch('/api/chat/b2b/ensure-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grantId }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { sessionId?: unknown }
    return typeof body.sessionId === 'string' ? body.sessionId : null
  }

  async function openTunnelRow(item: NavRowItem & { type: 'tunnel' }) {
    const gid = item.tunnelGrantId?.trim()
    if (!gid) return
    tunnelsError = null
    let sid = item.sessionId?.trim()
    if (!sid) {
      sid = (await ensureTunnelOutboundSession(gid)) ?? ''
    }
    if (!sid) {
      tunnelsError = $t('chat.history.tunnelsLoadFailed')
      return
    }
    emit({ type: 'chat:sessions-changed' })
    onSelect(sid, item.title)
  }

  function handleItemClick(item: NavRowItem) {
    if (item.type === 'tunnel') {
      void openTunnelRow(item)
      return
    }
    if (item.type === 'chat' && item.sessionId) {
      onSelect(item.sessionId, item.title)
    } else if (item.type === 'doc' && item.path && onSelectDoc) {
      onSelectDoc(item.path)
    }
  }

  function requestDelete(e: MouseEvent, item: NavRowItem) {
    e.stopPropagation()
    e.preventDefault()
    if (item.type === 'tunnel') {
      if (!item.sessionId) return
      pendingDelete = { sessionId: item.sessionId, label: labelForDeleteChatDialog(item.title) }
      return
    }
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
    class={cn(
      'ch-row group/chrow box-border m-0 flex w-full cursor-pointer items-center gap-1.5 px-1.5 py-1 text-left text-foreground transition-colors max-md:min-h-11 max-md:px-1.5 max-md:py-1.5',
      'hover:bg-surface-3 hover:[&_.wfn-name]:text-accent',
      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:[outline-offset:1px]',
      (item.type === 'chat' || item.type === 'tunnel') &&
        !!item.sessionId &&
        activeSessionId === item.sessionId &&
        'active bg-surface-selected outline outline-1 outline-accent hover:bg-surface-selected rounded-sm',
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
          (item.type === 'chat' || item.type === 'tunnel') && 'text-accent',
          (item.type === 'chat' || item.type === 'tunnel') && (agentWorking ? 'opacity-90' : 'opacity-75'),
        )}
      >
        {#if item.type === 'chat' || item.type === 'tunnel'}
          {#if agentWorking}
            <Loader2 class="sync-spinning" size={12} strokeWidth={2} aria-hidden="true" />
          {:else if item.type === 'tunnel'}
            <Link2 size={12} strokeWidth={2} aria-hidden="true" />
          {:else if item.type === 'chat' && item.sessionType === 'b2b_inbound'}
            <Bell size={12} strokeWidth={2} aria-hidden="true" />
          {:else}
            <MessageSquare size={12} strokeWidth={2} aria-hidden="true" />
          {/if}
        {/if}
      </span>
      <span
        class="ch-row-title inline-flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-[11px] leading-[1.32] max-md:text-lg max-md:leading-[1.35]"
      >
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{item.title}</span>
        {#if item.badgeLabel}
          <span
            class="shrink-0 rounded-full bg-accent/10 px-1.5 py-[1px] text-[9px] font-semibold uppercase leading-none tracking-wide text-accent max-md:text-[11px]"
          >
            {item.badgeLabel}
          </span>
        {/if}
      </span>
    {/if}
    {#if !item.omitRowTime}
      <span class="ch-row-time ms-0.5 me-1.5 shrink-0 text-[10px] text-muted/70 max-md:text-sm"
        >{shortTime(item.timestamp)}</span>
    {/if}
    {#if item.type !== 'tunnel' || item.sessionId}
      <button
        type="button"
        class={cn(
          'ch-row-delete shrink-0 p-[3px] text-muted opacity-0 transition-[opacity,color,background]',
          '[@media(hover:none)]:opacity-100 group-hover/chrow:opacity-45 hover:!opacity-100 hover:!text-danger hover:!bg-[rgba(224,92,92,0.12)]',
          item.omitRowTime ? 'me-1.5' : '',
        )}
        title={
          item.type === 'chat' || item.type === 'tunnel'
            ? $t('chat.agentChat.deleteChatAria')
            : $t('chat.history.removeFromHistoryAria')
        }
        aria-label={
          item.type === 'chat' || item.type === 'tunnel'
            ? $t('chat.agentChat.deleteChatAria')
            : $t('chat.history.removeFromHistoryAria')
        }
        onclick={(e) => requestDelete(e, item)}
      >
        <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
      </button>
    {/if}
  </div>
{/snippet}

<div class="chat-history box-border flex h-full min-h-0 flex-col bg-surface-2 pt-2.5">
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3.5 max-md:pb-3">
    {#if loading}
      <div class="ch-muted px-0.5 py-2.5 text-xs text-muted max-md:text-sm">{$t('common.status.loading')}</div>
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
          {$t('chat.history.chatsHeading')}
        </h2>
        <button
          type="button"
          class={cn(chatHistoryRailPrimaryBtn, 'new-chat-btn border-0 hover:border-transparent')}
          onclick={() => onNewChat()}
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
          <span>{$t('chat.history.newChat')}</span>
        </button>
        {#if chatItems.length === 0}
          <div class={cn(chatHistoryRailEmptyMutedClass, 'ch-muted--section')}>{$t('chat.history.emptyChats')}</div>
        {:else}
          <div class={chatHistoryRowListClass}>
            {#each chatItems as item (item.id)}
              {@render navRow(item)}
            {/each}
          </div>
          {#if hasMoreChats && onOpenAllChats}
            <button type="button" class={cn(chatHistoryRailViewAllBtn, 'ch-view-all')} onclick={() => onOpenAllChats()}>
              {$t('chat.history.viewAllChats')}
            </button>
          {/if}
        {/if}
      </section>

      <section
        class="ch-group ch-group--tunnels m-0 mt-1 flex min-w-0 w-full max-w-full flex-col border-t border-border pt-3.5 pb-5"
        aria-labelledby="ch-heading-tunnels"
      >
        <h2
          class="ch-group-label m-0 px-2 pb-2 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted max-md:text-[11px]"
          id="ch-heading-tunnels"
        >
          {$t('chat.history.tunnelsHeading')}
        </h2>
        {#if tunnelsError}
          <div class="ch-error px-2 pb-1 text-[10px] text-danger max-md:text-xs">{tunnelsError}</div>
        {/if}
        {#if tunnelNavRows.length === 0}
          <div class={cn(chatHistoryRailEmptyMutedClass, 'ch-muted--section')}>
            {$t('chat.history.emptyTunnels')}
          </div>
        {:else}
          <div class={chatHistoryRowListClass}>
            {#each tunnelNavRows as item (item.id)}
              {@render navRow(item)}
            {/each}
          </div>
        {/if}
      </section>

      <section
        class="ch-group ch-group--inbound m-0 mt-1 flex min-w-0 w-full max-w-full flex-col border-t border-border pt-3.5 pb-5"
        aria-labelledby="ch-heading-inbound"
      >
        <h2
          class="ch-group-label m-0 inline-flex items-center gap-1.5 px-2 pb-2 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted max-md:text-[11px]"
          id="ch-heading-inbound"
        >
          <span>{$t('chat.history.inboundHeading')}</span>
          {#if pendingInboundCount > 0}
            <span
              class="rounded-full bg-accent/10 px-1.5 py-[1px] text-[9px] leading-none text-accent"
              aria-label={$t('chat.history.pendingCountAria', { count: pendingInboundCount })}
            >
              {pendingInboundCount}
            </span>
          {/if}
        </h2>
        {#if inboundItems.length === 0}
          <div class={cn(chatHistoryRailEmptyMutedClass, 'ch-muted--section')}>
            {$t('chat.history.emptyInbound')}
          </div>
        {:else}
          <div class={chatHistoryRowListClass}>
            {#each inboundItems as item (item.id)}
              {@render navRow(item)}
            {/each}
          </div>
        {/if}
      </section>

      <section
        class="ch-group ch-group--wiki m-0 mt-1 flex min-w-0 w-full max-w-full flex-col border-t border-border pt-3.5"
        aria-labelledby="ch-heading-wiki"
      >
        <h2
          class="ch-group-label m-0 px-2 pb-2 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted max-md:text-[11px]"
          id="ch-heading-wiki"
        >
          {$t('chat.history.wikiHeading')}
        </h2>
        {#if onWikiHome}
          <button
            type="button"
            class={cn(chatHistoryRailPrimaryBtn, 'wiki-home-btn border-0 hover:border-transparent')}
            onclick={() => onWikiHome()}
          >
            <BookOpen size={14} strokeWidth={2.5} aria-hidden="true" />
            <span>{$t('nav.wiki.home')}</span>
          </button>
        {/if}
        {#if wikiNavItems.length === 0}
          <div class={cn(chatHistoryRailEmptyMutedClass, 'ch-muted--section')}>
            {$t('chat.history.emptyWikiPages')}
          </div>
        {:else}
          <div class={chatHistoryRowListClass}>
            {#each wikiNavItems as item (item.id)}
              {@render navRow(item)}
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>

  <ConfirmDialog
    open={pendingDelete !== null}
    title={$t('chat.agentChat.deleteDialogTitle')}
    titleId="ch-delete-title"
    confirmLabel={$t('chat.agentChat.deleteConfirmLabel')}
    cancelLabel={$t('common.actions.cancel')}
    confirmVariant="danger"
    onDismiss={cancelDelete}
    onConfirm={() => void confirmDelete()}
  >
    {#if pendingDelete}
      <p>{$t('chat.agentChat.deleteDialogBody', { label: pendingDelete.label })}</p>
    {/if}
  </ConfirmDialog>
</div>
