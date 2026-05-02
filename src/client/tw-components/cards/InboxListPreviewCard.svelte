<script lang="ts">
  import { onMount } from 'svelte'
  import { Archive, Inbox } from 'lucide-svelte'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { formatDate } from '@client/lib/formatDate.js'
  import type { InboxListItemPreview } from '@client/lib/cards/contentCards.js'

  let {
    items,
    totalCount,
    onOpenEmail,
    onOpenFullInbox,
  }: {
    items: InboxListItemPreview[]
    totalCount: number
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
  } = $props()

  let archivedIds = $state(new Set<string>())
  let archivingId = $state<string | null>(null)

  const PREVIEW_ROWS = 5

  /** Rows not archived in-session; we only render the first PREVIEW_ROWS so archiving backfills from the rest of the list. */
  const visible = $derived(items.filter((i) => !archivedIds.has(i.id)))

  const displayRows = $derived(visible.slice(0, PREVIEW_ROWS))

  async function archive(id: string) {
    if (archivingId) return
    archivingId = id
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(id)}/archive`, { method: 'POST' })
      if (res.ok) {
        archivedIds = new Set([...archivedIds, id])
        emit({ type: 'inbox:archived', messageId: id })
      }
    } finally {
      archivingId = null
    }
  }

  onMount(() => {
    return subscribe((e) => {
      if (e.type !== 'inbox:archived') return
      if (archivedIds.has(e.messageId)) return
      archivedIds = new Set([...archivedIds, e.messageId])
    })
  })

  function truncate(s: string, max: number) {
    const t = s.replace(/\s+/g, ' ').trim()
    if (t.length <= max) return t
    return t.slice(0, max).trimEnd() + '…'
  }
</script>

<div class="inbox-tool-preview mt-1 min-w-0 max-w-full">
  <div class="inbox-tool-head mb-2 flex flex-wrap items-center gap-2 text-muted">
    <Inbox size={14} strokeWidth={2} aria-hidden="true" />
    <span class="inbox-tool-title text-xs font-semibold uppercase tracking-wide">Inbox</span>
    {#if totalCount > 0}
      <span class="inbox-tool-meta ml-auto text-[11px] opacity-85">{totalCount} {totalCount === 1 ? 'message' : 'messages'}</span>
    {/if}
  </div>

  {#if visible.length === 0}
    <p class="inbox-tool-empty mb-1.5 text-xs text-muted">No messages in preview.</p>
  {:else}
    <ul class="inbox-tool-rows m-0 flex list-none flex-col gap-0 p-0">
      {#each displayRows as row (row.id)}
        <li
          class="inbox-row flex min-w-0 items-stretch gap-1 border-b border-[color-mix(in_srgb,var(--border)_55%,transparent)] py-1.5 last:border-b-0"
        >
          <button
            type="button"
            class="row-open group flex flex-1 min-w-0 cursor-pointer flex-col items-stretch gap-[2px] border-none bg-transparent px-2.5 py-2 text-left font-[inherit] text-[inherit]"
            onclick={() => onOpenEmail?.(row.id, row.subject, row.from)}
            aria-label="Open: {row.subject}"
          >
            <span class="row-line1 flex min-w-0 items-baseline justify-between gap-2">
              <span class="row-from min-w-0 truncate text-xs font-semibold">{row.from || '(unknown)'}</span>
              {#if row.date}
                <span class="row-date shrink-0 text-[10px] text-muted">{formatDate(row.date)}</span>
              {/if}
            </span>
            <span
              class="row-subject overflow-hidden text-xs leading-[1.35] text-foreground [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] group-hover:text-accent"
            >{row.subject}</span>
            {#if row.snippet}
              <span
                class="row-snippet overflow-hidden text-[11px] leading-[1.35] text-muted [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
              >{truncate(row.snippet, 72)}</span>
            {/if}
          </button>
          <button
            type="button"
            class="row-archive flex w-9 shrink-0 cursor-pointer items-center justify-center border-0 border-l border-[color-mix(in_srgb,var(--border)_55%,transparent)] bg-transparent p-0 text-muted hover:not-disabled:text-accent disabled:cursor-wait disabled:opacity-60"
            disabled={archivingId === row.id}
            title="Archive"
            aria-label="Archive message"
            onclick={() => void archive(row.id)}
          >
            {#if archivingId === row.id}
              <span class="row-archive-spin h-3.5 w-3.5 border-2 border-border border-t-accent" aria-hidden="true"></span>
            {:else}
              <Archive size={15} strokeWidth={2} aria-hidden="true" />
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if onOpenFullInbox}
    <button
      type="button"
      class="inbox-tool-full mt-2 cursor-pointer border-none bg-transparent p-0 text-left text-xs font-semibold text-accent hover:underline"
      onclick={() => onOpenFullInbox()}
    >Show full inbox</button>
  {/if}
</div>

<style>
  .row-archive-spin {
    animation: inbox-spin 0.7s linear infinite;
  }

  @keyframes inbox-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
