<script lang="ts">
  import { onMount } from 'svelte'
  import DayEvents from '@components/DayEvents.svelte'
  import WikiFileList from '@components/WikiFileList.svelte'
  import { cn } from '@client/lib/cn.js'
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
      const res = await fetch('/api/inbox', { credentials: 'include' }).catch(() => null)
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

  const cardCls = 'card border border-border bg-surface-2 px-4 py-3.5'
  const sectionTitleCls = 'section-title m-0 mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted'
  const mutedCls = 'muted text-xs text-muted opacity-70'
</script>

<div class="home h-full overflow-y-auto px-4 pb-10 pt-6">
  <div class="home-inner mx-auto flex max-w-[560px] flex-col gap-4">
    <h1 class="date-heading m-0 mb-1 text-lg font-semibold text-foreground">{todayLabel}</h1>

    <!-- Today's calendar -->
    <section class={cardCls}>
      <h2 class={sectionTitleCls}>Today</h2>
      <DayEvents date={today} />
    </section>

    <!-- Inbox summary -->
    <section class={cardCls}>
      <h2 class={sectionTitleCls}>
        Inbox
        {#if unreadCount > 0}
          <span class="badge bg-accent px-[7px] py-px text-[10px] font-semibold normal-case tracking-normal text-white">{unreadCount} unread</span>
        {/if}
      </h2>
      {#if inboxLoading}
        <div class={mutedCls}>Loading…</div>
      {:else if inboxItems.length === 0}
        <div class={mutedCls}>No messages</div>
      {:else}
        <ul class="item-list m-0 flex list-none flex-col gap-0.5 p-0">
          {#each inboxItems.slice(0, 5) as msg (msg.id)}
            <li>
              <button
                class={cn(
                  'inbox-item grid w-full grid-cols-[minmax(0,130px)_1fr_auto] items-baseline gap-2 cursor-pointer px-1.5 py-[5px] text-left text-xs text-muted',
                  !msg.read && 'unread bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] text-foreground hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]',
                  msg.read && 'hover:bg-surface-3',
                )}
                onclick={() => onOpenInbox(msg.id)}
              >
                <span class={cn(
                  'inbox-from overflow-hidden text-ellipsis whitespace-nowrap font-medium text-inherit',
                  !msg.read && 'text-accent',
                )}>{msg.from}</span>
                <span class="inbox-subject overflow-hidden text-ellipsis whitespace-nowrap">{msg.subject}</span>
                <span class="inbox-date shrink-0 whitespace-nowrap text-[11px] text-muted">{formatDate(msg.date)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- Recent doc changes -->
    <section class={cn(cardCls, 'card--files px-0 pb-0 pt-3.5 overflow-hidden')}>
      <h2 class={cn(sectionTitleCls, 'px-4 pb-2.5')}>Docs</h2>
      {#if dirty.length === 0 && recent.length === 0}
        <div class={cn(mutedCls, 'px-4 pb-3.5')}>No recent changes</div>
      {:else}
        <WikiFileList {dirty} {recent} onOpen={onOpenWiki} showSectionLabels={dirty.length > 0} />
      {/if}
    </section>

  </div>
</div>
