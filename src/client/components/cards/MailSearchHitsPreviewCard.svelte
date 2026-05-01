<script lang="ts">
  import { FileText, Mail } from 'lucide-svelte'
  import type { MailSearchHitPreview } from '@client/lib/cards/contentCardShared.js'
  import { searchHitPrimarySubtitle, searchHitSnippetLine } from '@client/lib/cards/searchHitRowMeta.js'
  import { searchHitIsIndexedFile } from '@client/lib/tools/matchPreview.js'

  const PREVIEW_ROWS = 3

  let {
    queryLine,
    items,
    totalMatched,
    searchSource,
    onOpenEmail,
    onOpenIndexedFile,
  }: {
    queryLine: string
    items: MailSearchHitPreview[]
    totalMatched?: number
    /** From search_index `source` arg — forwarded when opening Drive/local file hits. */
    searchSource?: string
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenIndexedFile?: (_id: string, _source?: string) => void
  } = $props()

  const rows = $derived(items.slice(0, PREVIEW_ROWS))
  const more = $derived(
    typeof totalMatched === 'number' && totalMatched > rows.length
      ? totalMatched - rows.length
      : items.length > PREVIEW_ROWS
        ? items.length - PREVIEW_ROWS
        : 0,
  )

  function openRow(hit: MailSearchHitPreview) {
    if (searchHitIsIndexedFile(hit, searchSource)) {
      onOpenIndexedFile?.(hit.id, searchSource)
    } else {
      onOpenEmail?.(hit.id, hit.subject, hit.from)
    }
  }

  function primaryLine(row: MailSearchHitPreview): string {
    return searchHitPrimarySubtitle(row, {
      isIndexed: searchHitIsIndexedFile(row, searchSource),
      searchSource,
    })
  }
</script>

<div class="mail-search-preview">
  <div class="mail-search-query" title={queryLine}>{queryLine}</div>
  {#if rows.length === 0}
    <p class="mail-search-empty">No matching emails or indexed files.</p>
  {:else}
    <ul class="mail-search-list" role="list">
      {#each rows as row (row.id)}
        <li>
          <button
            type="button"
            class="mail-search-row"
            onclick={() => openRow(row)}
          >
            <span class="mail-search-title-line">
              <span class="mail-search-icon" aria-hidden="true">
                {#if searchHitIsIndexedFile(row, searchSource)}
                  <FileText size={12} />
                {:else}
                  <Mail size={12} />
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
    gap: 0;
  }
  .mail-search-list li:not(:first-child) .mail-search-row {
    margin-top: 6px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
  }
  /* Icon 12px + gap 6px — indent meta/snippet so they never share a row with the title (mobile-safe). */
  .mail-search-row {
    --mail-hit-gutter: calc(12px + 6px);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 3px;
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
  .mail-search-title-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .mail-search-row:hover .mail-search-subject {
    color: var(--accent);
  }
  .mail-search-icon {
    flex-shrink: 0;
    display: inline-flex;
    color: var(--text-2);
  }
  .mail-search-subject {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mail-search-from {
    padding-inline-start: var(--mail-hit-gutter);
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-2);
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .mail-search-snippet {
    padding-inline-start: var(--mail-hit-gutter);
    font-size: 11px;
    line-height: 1.35;
    color: var(--text-2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .mail-search-more {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--text-2);
  }
</style>
