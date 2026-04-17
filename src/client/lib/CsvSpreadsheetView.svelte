<script lang="ts">
  import CsvSpreadsheetTable from './CsvSpreadsheetTable.svelte'
  import { parseDelimitedToGrid } from './csvSpreadsheet.js'

  let {
    text,
    delimiter,
  }: {
    text: string
    delimiter: ',' | '\t'
  } = $props()

  const result = $derived.by(() => parseDelimitedToGrid(text, delimiter))
</script>

<div class="sheet-wrap">
  {#if 'error' in result}
    <p class="parse-err" role="alert">{result.error}</p>
    <pre class="fallback">{text}</pre>
  {:else if result.headers.length === 0}
    <p class="muted">Empty file</p>
  {:else}
    <CsvSpreadsheetTable headers={result.headers} rows={result.rows} />
  {/if}
</div>

<style>
  .sheet-wrap {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    gap: 8px;
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
