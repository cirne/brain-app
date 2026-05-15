<script lang="ts">
  import { cn } from '@client/lib/cn.js'
  import CsvSpreadsheetTable from '@components/CsvSpreadsheetTable.svelte'
  import { parseSpreadsheetFromText, spreadsheetDelimiterForPath } from '@client/lib/csvSpreadsheet.js'
  import { t } from '@client/lib/i18n/index.js'

  let {
    text,
    /** Resolved file path — delimiter: tab only for `.tsv`; xlsx/xls/csv use comma (ripmail CSV). */
    path,
    delimiter: delimiterOverride,
  }: {
    text: string
    path?: string
    delimiter?: ',' | '\t'
  } = $props()

  let selectedSheet = $state(0)

  const parsed = $derived.by(() => {
    const d =
      delimiterOverride ??
      (path?.trim() ? spreadsheetDelimiterForPath(path.trim()) : ',')
    return parseSpreadsheetFromText(text, d)
  })

  $effect(() => {
    void text
    void path
    selectedSheet = 0
  })

  const activeGrid = $derived.by(() => {
    const p = parsed
    if (p.mode === 'single') return p.grid
    const s = p.sheets[selectedSheet]
    return s?.grid ?? { error: $t('inbox.csvSpreadsheetView.errors.invalidSheet') }
  })
</script>

<div class="sheet-wrap flex min-h-0 flex-1 flex-col gap-0">
  {#if parsed.mode === 'multi' && parsed.sheets.length > 1}
    <div
      class="sheet-tabs-scroll max-w-full shrink-0 overflow-x-auto overflow-y-hidden border-b border-[var(--border,#ccc)] bg-[var(--bg-2,#e8e8ea)] [-webkit-overflow-scrolling:touch] [scrollbar-gutter:stable]"
    >
      <div
        class="sheet-tabs inline-flex min-h-[26px] w-max max-w-none flex-row flex-nowrap items-stretch gap-0"
        role="tablist"
        aria-label={$t('inbox.csvSpreadsheetView.workbookSheetsAriaLabel')}
      >
        {#each parsed.sheets as sh, i (sh.name + i)}
          <button
            type="button"
            role="tab"
            class={cn(
              'sheet-tab m-0 shrink-0 cursor-pointer whitespace-nowrap border-none border-r border-[var(--border,#c8c8cc)] px-2 py-1 text-[0.6875rem] leading-tight text-[var(--text-2,#555)] [background:rgba(0,0,0,0.04)] last:border-r-0 hover:[background:rgba(0,0,0,0.07)] hover:text-[var(--text,#111)]',
              selectedSheet === i && 'active bg-[var(--bg,#fff)] text-[var(--text,#111)] font-semibold',
            )}
            aria-selected={selectedSheet === i}
            onclick={() => { selectedSheet = i }}
          >
            {sh.name || $t('inbox.csvSpreadsheetView.sheetFallback', { index: i + 1 })}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="sheet-body flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    {#if 'error' in activeGrid}
      <p class="parse-err m-0 mb-2 text-sm text-[var(--error,#c44)]" role="alert">{activeGrid.error}</p>
      <pre
        class="fallback m-0 whitespace-pre-wrap [word-break:break-word] text-[0.85rem] leading-normal [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace]"
      >{text}</pre>
    {:else if activeGrid.headers.length === 0}
      <p class="muted text-[0.9rem] text-muted">{$t('inbox.csvSpreadsheetView.emptyFile')}</p>
    {:else}
      <CsvSpreadsheetTable headers={activeGrid.headers} rows={activeGrid.rows} />
    {/if}
  </div>
</div>
