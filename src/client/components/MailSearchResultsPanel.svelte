<script lang="ts">
  import { FileText, Mail } from '@lucide/svelte'
  import type { MailSearchHitPreview } from '@client/lib/cards/contentCards.js'
  import { searchHitPrimarySubtitle, searchHitSnippetLine } from '@client/lib/cards/searchHitRowMeta.js'
  import { searchHitIsIndexedFile } from '@client/lib/tools/matchPreview.js'
  import { t } from '@client/lib/i18n/index.js'

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
    return $t('inbox.mailSearchResultsPanel.count.results', { count: n })
  })

  function openRow(row: MailSearchHitPreview) {
    if (searchHitIsIndexedFile(row, searchSource)) {
      onOpenIndexedFile?.(row.id, searchSource)
    } else {
      onOpenEmail?.(row.id, row.subject, row.from)
    }
  }

  function ariaOpenLabel(row: MailSearchHitPreview): string {
    const sub = row.subject || $t('inbox.mailSearchResultsPanel.noSubject')
    const idx = searchHitIsIndexedFile(row, searchSource)
    const meta = searchHitPrimarySubtitle(row, { isIndexed: idx, searchSource }).trim()
    const kind = idx
      ? $t('inbox.mailSearchResultsPanel.aria.openIndexedFile')
      : $t('inbox.mailSearchResultsPanel.aria.openEmail')
    return meta ? `${kind} ${sub}, ${meta}` : `${kind} ${sub}`
  }

  function primaryLine(row: MailSearchHitPreview): string {
    return searchHitPrimarySubtitle(row, {
      isIndexed: searchHitIsIndexedFile(row, searchSource),
      searchSource,
    })
  }
</script>

<div
  class="mail-search-panel box-border flex min-h-0 flex-1 flex-col gap-3.5 overflow-hidden py-3.5"
>
  <div class="mail-search-summary flex min-w-0 shrink-0 flex-col gap-1 px-3.5">
    <div
      class="mail-search-query overflow-wrap-anywhere text-xs leading-tight text-foreground [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace] [overflow-wrap:anywhere]"
      title={queryLine}
    >{queryLine}</div>
    {#if countLabel}
      <div class="mail-search-count text-xs leading-snug text-muted">{countLabel}</div>
    {/if}
  </div>

  {#if items === null}
    <p class="mail-search-empty m-0 shrink-0 px-3.5 text-xs leading-snug text-muted">{$t('inbox.mailSearchResultsPanel.empty.resultsExpired')}</p>
  {:else if items.length === 0}
    <p class="mail-search-empty m-0 shrink-0 px-3.5 text-xs leading-snug text-muted">{$t('inbox.mailSearchResultsPanel.empty.noMatches')}</p>
  {:else}
    <ul
      class="mail-search-list m-0 flex min-h-0 min-w-0 flex-1 list-none flex-col overflow-x-hidden overflow-y-auto p-0"
      role="list"
    >
      {#each items as row (row.id)}
        <li>
          <button
            type="button"
            class="mail-search-row m-0 flex w-full min-w-0 cursor-pointer flex-col items-stretch gap-[3px] border-none bg-transparent px-3.5 py-1.5 text-left text-inherit [font:inherit] hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--text)_4%,transparent)]"
            onclick={() => openRow(row)}
            aria-label={ariaOpenLabel(row)}
          >
            <span class="mail-search-title-line flex min-w-0 items-center gap-2">
              <span class="mail-search-icon inline-flex shrink-0 text-muted" aria-hidden="true">
                {#if searchHitIsIndexedFile(row, searchSource)}
                  <FileText size={14} />
                {:else}
                  <Mail size={14} />
                {/if}
              </span>
              <span
                class="mail-search-subject min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis text-[13px] font-semibold leading-tight"
              >{row.subject || $t('inbox.mailSearchResultsPanel.noSubject')}</span>
            </span>
            {#if primaryLine(row)}
              <span
                class="mail-search-from text-xs leading-snug text-muted [overflow-wrap:anywhere] [padding-inline-start:var(--mail-hit-gutter)] [word-break:break-word]"
              >{primaryLine(row)}</span>
            {/if}
            {#if searchHitSnippetLine(row)}
              <span
                class="mail-search-snippet overflow-hidden text-xs leading-snug text-muted [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box] [overflow-wrap:anywhere] [padding-inline-start:var(--mail-hit-gutter)]"
              >{searchHitSnippetLine(row)}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .mail-search-row {
    --mail-hit-gutter: calc(14px + 8px);
  }

  .mail-search-list li:not(:first-child) .mail-search-row {
    border-top: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
  }

  .mail-search-row:hover .mail-search-subject,
  .mail-search-row:focus-visible .mail-search-subject {
    color: var(--accent);
  }
</style>
