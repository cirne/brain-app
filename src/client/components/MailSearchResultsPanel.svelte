<script lang="ts">
  import { FileText, Mail } from 'lucide-svelte'
  import type { MailSearchHitPreview } from '@client/lib/cards/contentCards.js'
  import { searchHitPrimarySubtitle, searchHitSnippetLine } from '@client/lib/cards/searchHitRowMeta.js'
  import { searchHitIsIndexedFile } from '@client/lib/tools/matchPreview.js'

  let {
    queryLine,
    items,
    totalMatched,
    searchSource,
    onOpenEmail,
    onOpenIndexedFile,
  }: {
    queryLine: string
    items: MailSearchHitPreview[] | null
    totalMatched?: number
    searchSource?: string
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenIndexedFile?: (_id: string, _source?: string) => void
  } = $props()

  const countLabel = $derived.by(() => {
    if (!items) return ''
    const n = typeof totalMatched === 'number' ? totalMatched : items.length
    return `${n} result${n === 1 ? '' : 's'}`
  })

  function openRow(row: MailSearchHitPreview) {
    if (searchHitIsIndexedFile(row, searchSource)) {
      onOpenIndexedFile?.(row.id, searchSource)
    } else {
      onOpenEmail?.(row.id, row.subject, row.from)
    }
  }

  function ariaOpenLabel(row: MailSearchHitPreview): string {
    const sub = row.subject || '(No subject)'
    const idx = searchHitIsIndexedFile(row, searchSource)
    const meta = searchHitPrimarySubtitle(row, { isIndexed: idx, searchSource }).trim()
    const kind = idx ? 'Open indexed file' : 'Open email'
    return meta ? `${kind} ${sub}, ${meta}` : `${kind} ${sub}`
  }

  function primaryLine(row: MailSearchHitPreview): string {
    return searchHitPrimarySubtitle(row, {
      isIndexed: searchHitIsIndexedFile(row, searchSource),
      searchSource,
    })
  }
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
    <p class="mail-search-empty">No matching emails or indexed files.</p>
  {:else}
    <ul class="mail-search-list" role="list">
      {#each items as row (row.id)}
        <li>
          <button
            type="button"
            class="mail-search-row"
            onclick={() => openRow(row)}
            aria-label={ariaOpenLabel(row)}
          >
            <span class="mail-search-title-line">
              <span class="mail-search-icon" aria-hidden="true">
                {#if searchHitIsIndexedFile(row, searchSource)}
                  <FileText size={14} />
                {:else}
                  <Mail size={14} />
                {/if}
              </span>
              <span class="mail-search-subject">{row.subject || '(No subject)'}</span>
            </span>
            {#if primaryLine(row)}
              <span class="mail-search-from">{primaryLine(row)}</span>
            {/if}
            {#if searchHitSnippetLine(row)}
              <span class="mail-search-snippet">{searchHitSnippetLine(row)}</span>
            {/if}
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
    --mail-hit-gutter: calc(14px + 8px);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 3px;
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

  .mail-search-title-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .mail-search-icon {
    flex-shrink: 0;
    display: inline-flex;
    color: var(--text-2);
  }

  .mail-search-subject {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mail-search-from {
    padding-inline-start: var(--mail-hit-gutter);
    font-size: 12px;
    line-height: 1.35;
    color: var(--text-2);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .mail-search-snippet {
    padding-inline-start: var(--mail-hit-gutter);
    font-size: 12px;
    line-height: 1.35;
    color: var(--text-2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
</style>
