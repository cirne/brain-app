<script lang="ts">
  let {
    headers,
    rows,
  }: {
    headers: string[]
    rows: string[][]
  } = $props()
</script>

<div class="sheet-root">
  <div class="sheet-scroll" tabindex="0" role="region" aria-label="Spreadsheet preview">
    <table class="sheet">
      <thead>
        <tr>
          {#each headers as h, i (i)}
            <th scope="col">{h}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row, ri (ri)}
          <tr class:stripe={ri % 2 === 1}>
            {#each headers as _, ci (ci)}
              <td>{row[ci] ?? ''}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="meta">{rows.length} data row{rows.length === 1 ? '' : 's'} · {headers.length} column{headers.length === 1 ? '' : 's'}</p>
</div>

<style>
  .sheet-root {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
    gap: 8px;
  }
  .sheet-scroll {
    flex: 1;
    min-height: 120px;
    overflow: auto;
    border: 1px solid var(--border, #ccc);
    border-radius: 6px;
    background: var(--bg-elevated, var(--bg, #fff));
  }
  .sheet {
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.8125rem;
    line-height: 1.35;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    white-space: nowrap;
  }
  .sheet thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--sheet-header-bg, #e8e8ea);
    color: var(--fg, #111);
    font-weight: 600;
    text-align: left;
    padding: 6px 10px;
    border-right: 1px solid var(--border, #c8c8cc);
    border-bottom: 1px solid var(--border, #999);
    box-shadow: 0 1px 0 var(--border, #999);
  }
  .sheet tbody td {
    padding: 4px 10px;
    border-right: 1px solid var(--sheet-cell-border, #ddd);
    border-bottom: 1px solid var(--sheet-cell-border, #ddd);
    background: var(--bg-elevated, var(--bg, #fff));
    max-width: 28rem;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: top;
  }
  .sheet tbody tr.stripe td {
    background: var(--sheet-stripe, rgba(0, 0, 0, 0.03));
  }
  .sheet tbody tr:hover td {
    background: var(--sheet-hover, rgba(80, 120, 200, 0.08));
  }
  .meta {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted, #888);
  }
</style>
