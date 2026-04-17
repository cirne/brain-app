<script lang="ts">
  import CsvSpreadsheetView from './CsvSpreadsheetView.svelte'
  import { isSpreadsheetDelimitedPath, spreadsheetDelimiterForPath } from './csvSpreadsheet.js'
  import type { SurfaceContext } from '../router.js'

  let {
    initialPath,
    onContextChange,
  }: {
    initialPath?: string
    onContextChange?: (_ctx: SurfaceContext) => void
  } = $props()

  let loading = $state(false)
  let err = $state('')
  let bodyText = $state('')

  const showSpreadsheet = $derived(initialPath ? isSpreadsheetDelimitedPath(initialPath) : false)
  const sheetDelimiter = $derived(
    initialPath ? spreadsheetDelimiterForPath(initialPath) : ',',
  )

  function titleFromPath(p: string) {
    const parts = p.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? p
  }

  $effect(() => {
    if (initialPath) void load(initialPath)
  })

  async function load(p: string) {
    loading = true
    err = ''
    bodyText = ''
    onContextChange?.({ type: 'file', path: p, title: titleFromPath(p) })
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(p)}`)
      const j = (await res.json().catch(() => ({}))) as { error?: string; bodyText?: string; path?: string }
      if (!res.ok) {
        err = typeof j.error === 'string' ? j.error : `HTTP ${res.status}`
        return
      }
      bodyText = typeof j.bodyText === 'string' ? j.bodyText : ''
      const showPath = typeof j.path === 'string' ? j.path : p
      onContextChange?.({ type: 'file', path: p, title: titleFromPath(showPath) })
    } catch (e) {
      err = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }
</script>

<div class="file-view" class:spreadsheet-mode={showSpreadsheet && !loading && !err}>
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if err}
    <p class="err">{err}</p>
  {:else if showSpreadsheet}
    <CsvSpreadsheetView text={bodyText} delimiter={sheetDelimiter} />
  {:else}
    <div class="pre-wrap">
      <pre class="body">{bodyText}</pre>
    </div>
  {/if}
</div>

<style>
  .file-view {
    height: 100%;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 12px 16px;
    box-sizing: border-box;
  }
  .file-view.spreadsheet-mode {
    overflow: hidden;
  }
  .file-view:not(.spreadsheet-mode) {
    overflow: auto;
  }
  .pre-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .muted {
    color: var(--muted, #888);
    font-size: 0.9rem;
  }
  .err {
    color: var(--error, #c44);
    font-size: 0.9rem;
  }
  .body {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.85rem;
    line-height: 1.45;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
</style>
