<script lang="ts">
  import { Mail } from 'lucide-svelte'
  import type { MailSearchHitPreview } from '@client/lib/cards/contentCards.js'

  let {
    queryLine,
    items,
    totalMatched,
    onOpenEmail,
  }: {
    queryLine: string
    items: MailSearchHitPreview[] | null
    totalMatched?: number
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
  } = $props()

  const countLabel = $derived.by(() => {
    if (!items) return ''
    const n = typeof totalMatched === 'number' ? totalMatched : items.length
    return `${n} result${n === 1 ? '' : 's'}`
  })
</script>

<div class="mail-search-panel">
  <div class="mail-search-summary">
    <div class="mail-search-query" title={queryLine}>{queryLine}</div>
    {#if countLabel}
      <div class="mail-search-count">{countLabel}</div>
    {/if}
  </div>

  {#if items === null}
    <p class="mail-search-empty">Search results are no longer available. Run the search again to refresh this view.</p>
  {:else if items.length === 0}
    <p class="mail-search-empty">No matching messages.</p>
  {:else}
    <ul class="mail-search-list" role="list">
      {#each items as row (row.id)}
        <li>
          <button
            type="button"
            class="mail-search-row"
            onclick={() => onOpenEmail?.(row.id, row.subject, row.from)}
            aria-label="Open email {row.subject || '(No subject)'}"
          >
            <span class="mail-search-icon" aria-hidden="true">
              <Mail size={14} />
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
  {/if}
</div>

<style>
  .mail-search-panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: hidden;
    padding-block: 14px;
    padding-inline: 0;
    box-sizing: border-box;
  }

  .mail-search-summary {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-shrink: 0;
    min-width: 0;
    padding-inline: 14px;
  }

  .mail-search-query {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text);
    overflow-wrap: anywhere;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .mail-search-count,
  .mail-search-empty {
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-2);
  }

  .mail-search-empty {
    margin: 0;
    flex-shrink: 0;
    padding-inline: 14px;
  }

  .mail-search-list {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 0;
    padding: 0;
    overflow-x: hidden;
    overflow-y: auto;
    list-style: none;
    min-width: 0;
  }

  .mail-search-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    min-width: 0;
    margin: 0;
    padding: 6px 14px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .mail-search-list li:not(:first-child) .mail-search-row {
    border-top: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
  }

  .mail-search-row:hover,
  .mail-search-row:focus-visible {
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }

  .mail-search-row:hover .mail-search-subject,
  .mail-search-row:focus-visible .mail-search-subject {
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
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mail-search-from,
  .mail-search-snippet {
    font-size: 12px;
    line-height: 1.35;
    color: var(--text-2);
  }

  .mail-search-snippet {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
