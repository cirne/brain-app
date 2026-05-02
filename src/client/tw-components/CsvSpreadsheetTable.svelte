<script lang="ts">
  import { isSpreadsheetNumericCell } from '@client/lib/csvSpreadsheet.js'

  let {
    headers,
    rows,
  }: {
    headers: string[]
    rows: string[][]
  } = $props()
</script>

<div class="sheet-root flex min-h-0 flex-1 flex-col gap-2">
  <div
    class="sheet-scroll min-h-[120px] flex-1 overflow-auto rounded-md border border-[var(--border,#ccc)] bg-[var(--bg-elevated,var(--bg,#fff))]"
    role="region"
    aria-label="Spreadsheet preview"
  >
    <table
      class="sheet whitespace-nowrap text-[0.8125rem] leading-snug [border-collapse:separate] [border-spacing:0] [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace]"
    >
      <thead>
        <tr>
          {#each headers as h, i (i)}
            <th
              scope="col"
              class="sticky top-0 z-[1] border-b border-r border-[var(--border,#999)] bg-[var(--sheet-header-bg,#e8e8ea)] px-2.5 py-1.5 text-left font-semibold text-[var(--fg,#111)] [box-shadow:0_1px_0_var(--border,#999)]"
            >{h}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row, ri (ri)}
          <tr class={ri % 2 === 1 ? 'stripe' : ''}>
            {#each headers as _, ci (ci)}
              {@const cell = row[ci] ?? ''}
              <td
                class="max-w-[28rem] overflow-hidden text-ellipsis border-b border-r border-[var(--sheet-cell-border,#ddd)] bg-[var(--bg-elevated,var(--bg,#fff))] px-2.5 py-1 align-top text-left {isSpreadsheetNumericCell(cell) ? 'numeric text-right' : ''}"
              >{cell}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="meta m-0 text-xs text-muted">{rows.length} data row{rows.length === 1 ? '' : 's'} · {headers.length} column{headers.length === 1 ? '' : 's'}</p>
</div>

<style>
  /* Stripe + hover row styling — sibling state requires scoped selectors. */
  .sheet tbody tr.stripe td {
    background: var(--sheet-stripe, rgba(0, 0, 0, 0.03));
  }
  .sheet tbody tr:hover td {
    background: var(--sheet-hover, rgba(80, 120, 200, 0.08));
  }
</style>
