<script lang="ts">
  import CsvSpreadsheetTable from './CsvSpreadsheetTable.svelte'
  import { parseSpreadsheetFromText, spreadsheetDelimiterForPath } from './csvSpreadsheet.js'

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
    border-top: 1px solid var(--border, #ccc);
    margin-top: 8px;
    padding-top: 8px;
    -webkit-overflow-scrolling: touch;
    scrollbar-gutter: stable;
  }
  .sheet-tabs {
    display: inline-flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    gap: 6px;
    width: max-content;
    max-width: none;
    padding-bottom: 2px;
  }
  .sheet-tab {
    flex-shrink: 0;
    border: 1px solid var(--border, #ccc);
    background: var(--bg-elevated, var(--bg, #fff));
    color: var(--fg, inherit);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 0.8125rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .sheet-tab:hover {
    background: var(--sheet-hover, rgba(80, 120, 200, 0.1));
  }
  .sheet-tab.active {
    border-color: var(--accent, #4a6fa5);
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
