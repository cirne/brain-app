<script lang="ts">
  import { Mail } from 'lucide-svelte'
  import type { MailSearchHitPreview } from '@client/lib/cards/contentCardShared.js'

  const PREVIEW_ROWS = 3

  let {
    queryLine,
    items,
    totalMatched,
    onOpenEmail,
  }: {
    queryLine: string
    items: MailSearchHitPreview[]
    totalMatched?: number
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
  } = $props()

  const rows = $derived(items.slice(0, PREVIEW_ROWS))
  const more = $derived(
    typeof totalMatched === 'number' && totalMatched > rows.length
      ? totalMatched - rows.length
      : items.length > PREVIEW_ROWS
        ? items.length - PREVIEW_ROWS
        : 0,
  )
</script>

<div class="mail-search-preview">
  <div class="mail-search-query" title={queryLine}>{queryLine}</div>
  {#if rows.length === 0}
    <p class="mail-search-empty">No matching messages.</p>
  {:else}
    <ul class="mail-search-list" role="list">
      {#each rows as row (row.id)}
        <li>
          <button
            type="button"
            class="mail-search-row"
            onclick={() => onOpenEmail?.(row.id, row.subject, row.from)}
          >
            <span class="mail-search-icon" aria-hidden="true">
              <Mail size={12} />
            </span>
            <span class="mail-search-body">
              <span class="mail-search-subject">{row.subject || '(No subject)'}</span>
              {#if row.from}
                <span class="mail-search-from">{row.from}</span>
              {/if}
              {#if row.snippet}
                <span class="mail-search-snippet">{row.snippet}</span>
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if more > 0}
      <p class="mail-search-more">+{more} more</p>
    {/if}
  {/if}
</div>

<style>
  .mail-search-preview {
    margin: 4px 0 0;
    min-width: 0;
    max-width: 100%;
  }
  .mail-search-query {
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-2);
    margin-bottom: 6px;
    overflow-wrap: anywhere;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  .mail-search-empty {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
  }
  .mail-search-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mail-search-row {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    width: 100%;
    text-align: left;
    font: inherit;
    color: inherit;
    background: transparent;
    border: none;
    padding: 4px 0;
    cursor: pointer;
    min-width: 0;
  }
  .mail-search-row:hover .mail-search-subject {
    color: var(--accent);
  }
  .mail-search-icon {
    flex-shrink: 0;
    color: var(--text-2);
    padding-top: 2px;
  }
  .mail-search-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .mail-search-subject {
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mail-search-from {
    font-size: 11px;
    color: var(--text-2);
  }
  .mail-search-snippet {
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .mail-search-more {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--text-2);
  }
</style>
