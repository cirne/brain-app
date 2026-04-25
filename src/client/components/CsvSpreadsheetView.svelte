<script lang="ts">
  import CsvSpreadsheetTable from './CsvSpreadsheetTable.svelte'
  import { parseSpreadsheetFromText, spreadsheetDelimiterForPath } from '@client/lib/csvSpreadsheet.js'

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
    return s?.grid ?? { error: 'Invalid sheet' }
  })
</script>

<div class="sheet-wrap">
  <div class="sheet-body">
    {#if 'error' in activeGrid}
      <p class="parse-err" role="alert">{activeGrid.error}</p>
      <pre class="fallback">{text}</pre>
    {:else if activeGrid.headers.length === 0}
      <p class="muted">Empty file</p>
    {:else}
      <CsvSpreadsheetTable headers={activeGrid.headers} rows={activeGrid.rows} />
    {/if}
  </div>

  {#if parsed.mode === 'multi' && parsed.sheets.length > 1}
    <div class="sheet-tabs-scroll">
      <div class="sheet-tabs" role="tablist" aria-label="Workbook sheets">
        {#each parsed.sheets as sh, i (sh.name + i)}
          <button
            type="button"
            role="tab"
            class="sheet-tab"
            class:active={selectedSheet === i}
            aria-selected={selectedSheet === i}
            onclick={() => { selectedSheet = i }}
          >
            {sh.name || `Sheet ${i + 1}`}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .sheet-wrap {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    gap: 0;
  }
  .sheet-body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sheet-tabs-scroll {
    flex-shrink: 0;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    margin-top: 8px;
    padding-top: 0;
    border-top: 1px solid var(--border, #ccc);
    background: var(--bg-2, #e8e8ea);
    -webkit-overflow-scrolling: touch;
    scrollbar-gutter: stable;
  }
  .sheet-tabs {
    display: inline-flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: stretch;
    gap: 0;
    width: max-content;
    max-width: none;
    min-height: 26px;
  }
  .sheet-tab {
    flex-shrink: 0;
    margin: 0;
    border: none;
    border-radius: 0;
    border-right: 1px solid var(--border, #c8c8cc);
    padding: 4px 8px;
    font-size: 0.6875rem;
    line-height: 1.2;
    cursor: pointer;
    white-space: nowrap;
    color: var(--text-2, #555);
    background: rgba(0, 0, 0, 0.04);
  }
  .sheet-tab:last-child {
    border-right: none;
  }
  .sheet-tab:hover {
    background: rgba(0, 0, 0, 0.07);
    color: var(--text, #111);
  }
  .sheet-tab.active {
    background: var(--bg, #fff);
    color: var(--text, #111);
    font-weight: 600;
  }
  .muted {
    color: var(--muted, #888);
    font-size: 0.9rem;
  }
  .parse-err {
    margin: 0 0 8px;
    color: var(--error, #c44);
    font-size: 0.875rem;
  }
  .fallback {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.85rem;
    line-height: 1.45;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
</style>
