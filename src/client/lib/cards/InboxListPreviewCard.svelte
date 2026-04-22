<script lang="ts">
  import { onMount } from 'svelte'
  import { Archive, Inbox } from 'lucide-svelte'
  import { emit, subscribe } from '../app/appEvents.js'
  import { formatDate } from '../formatDate.js'
  import type { InboxListItemPreview } from './contentCards.js'

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

<div class="inbox-tool-preview">
  <div class="inbox-tool-head">
    <Inbox size={14} strokeWidth={2} aria-hidden="true" />
    <span class="inbox-tool-title">Inbox</span>
    {#if totalCount > 0}
      <span class="inbox-tool-meta">{totalCount} {totalCount === 1 ? 'message' : 'messages'}</span>
    {/if}
  </div>

  {#if visible.length === 0}
    <p class="inbox-tool-empty">No messages in preview.</p>
  {:else}
    <ul class="inbox-tool-rows">
      {#each displayRows as row (row.id)}
        <li class="inbox-row">
          <button
            type="button"
            class="row-open"
            onclick={() => onOpenEmail?.(row.id, row.subject, row.from)}
            aria-label="Open: {row.subject}"
          >
            <span class="row-line1">
              <span class="row-from">{row.from || '(unknown)'}</span>
              {#if row.date}
                <span class="row-date">{formatDate(row.date)}</span>
              {/if}
            </span>
            <span class="row-subject">{row.subject}</span>
            {#if row.snippet}
              <span class="row-snippet">{truncate(row.snippet, 72)}</span>
            {/if}
          </button>
          <button
            type="button"
            class="row-archive"
            disabled={archivingId === row.id}
            title="Archive"
            aria-label="Archive message"
            onclick={() => void archive(row.id)}
          >
            {#if archivingId === row.id}
              <span class="row-archive-spin" aria-hidden="true"></span>
            {:else}
              <Archive size={15} strokeWidth={2} aria-hidden="true" />
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if onOpenFullInbox}
    <button type="button" class="inbox-tool-full" onclick={() => onOpenFullInbox()}>
      Show full inbox
    </button>
  {/if}
</div>

<style>
  .inbox-tool-preview {
    margin: 4px 0 0;
    max-width: 100%;
    min-width: 0;
  }

  .inbox-tool-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    color: var(--text-2);
    flex-wrap: wrap;
  }

  .inbox-tool-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .inbox-tool-meta {
    font-size: 11px;
    margin-left: auto;
    opacity: 0.85;
  }

  .inbox-tool-empty {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--text-2);
  }

  .inbox-tool-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .inbox-row {
    display: flex;
    align-items: stretch;
    gap: 4px;
    min-width: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
    padding: 6px 0;
  }

  .inbox-row:last-child {
    border-bottom: none;
  }

  .row-open {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    padding: 8px 10px;
    border: none;
    background: transparent;
    font: inherit;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }

  .row-open:hover .row-subject {
    color: var(--accent);
  }

  .row-line1 {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .row-from {
    font-size: 12px;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-date {
    font-size: 10px;
    color: var(--text-2);
    flex-shrink: 0;
  }

  .row-subject {
    font-size: 12px;
    line-height: 1.35;
    color: var(--text);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .row-snippet {
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .row-archive {
    flex-shrink: 0;
    width: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-left: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    padding: 0;
  }

  .row-archive:hover:not(:disabled) {
    color: var(--accent);
  }

  .row-archive:disabled {
    opacity: 0.6;
    cursor: wait;
  }

  .row-archive-spin {
    width: 14px;
    height: 14px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: inbox-spin 0.7s linear infinite;
  }

  @keyframes inbox-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .inbox-tool-full {
    margin-top: 8px;
    padding: 0;
    border: none;
    background: transparent;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    cursor: pointer;
    text-align: left;
  }

  .inbox-tool-full:hover {
    text-decoration: underline;
  }
</style>
