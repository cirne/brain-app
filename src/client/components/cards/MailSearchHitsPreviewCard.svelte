<script lang="ts">
  import { FileText, Mail } from 'lucide-svelte'
  import type { MailSearchHitPreview } from '@client/lib/cards/contentCardShared.js'
  import { searchHitPrimarySubtitle, searchHitSnippetLine } from '@client/lib/cards/searchHitRowMeta.js'
  import { searchHitIsIndexedFile } from '@client/lib/tools/matchPreview.js'
  import { t } from '@client/lib/i18n/index.js'

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

<div class="mail-search-preview mt-1 min-w-0 max-w-full">
  <div
    class="mail-search-query mb-1.5 font-mono text-[11px] leading-[1.35] text-muted [overflow-wrap:anywhere]"
    title={queryLine}
  >{queryLine}</div>
  {#if rows.length === 0}
    <p class="mail-search-empty m-0 text-xs text-muted">{$t('cards.mailSearchHitsPreviewCard.empty')}</p>
  {:else}
    <ul class="mail-search-list m-0 flex list-none flex-col gap-0 p-0" role="list">
      {#each rows as row (row.id)}
        <li
          class="[&:not(:first-child)>button]:mt-1.5 [&:not(:first-child)>button]:border-t [&:not(:first-child)>button]:border-[color-mix(in_srgb,var(--border)_65%,transparent)] [&:not(:first-child)>button]:pt-2.5"
        >
          <button
            type="button"
            class="mail-search-row group flex w-full min-w-0 cursor-pointer flex-col items-stretch gap-[3px] border-none bg-transparent px-0 py-1 text-left font-[inherit] text-[inherit] [--mail-hit-gutter:18px]"
            onclick={() => openRow(row)}
          >
            <span class="mail-search-title-line flex min-w-0 items-center gap-1.5">
              <span class="mail-search-icon inline-flex shrink-0 text-muted" aria-hidden="true">
                {#if searchHitIsIndexedFile(row, searchSource)}
                  <FileText size={12} />
                {:else}
                  <Mail size={12} />
                {/if}
              </span>
              <span
                class="mail-search-subject flex-1 min-w-0 truncate text-xs font-semibold leading-[1.3] group-hover:text-accent"
              >{row.subject || $t('cards.mailSearchHitsPreviewCard.noSubject')}</span>
            </span>
            {#if primaryLine(row)}
              <span
                class="mail-search-from text-[11px] leading-[1.35] text-muted break-words [overflow-wrap:anywhere] [padding-inline-start:var(--mail-hit-gutter)]"
              >{primaryLine(row)}</span>
            {/if}
            {#if searchHitSnippetLine(row)}
              <span
                class="mail-search-snippet text-[11px] leading-[1.35] text-muted overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] [overflow-wrap:anywhere] [padding-inline-start:var(--mail-hit-gutter)]"
              >{searchHitSnippetLine(row)}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
    {#if more > 0}
      <p class="mail-search-more mt-1.5 text-[11px] text-muted">{$t('cards.mailSearchHitsPreviewCard.more', { count: more })}</p>
    {/if}
  {/if}
</div>
