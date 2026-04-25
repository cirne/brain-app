<script lang="ts">
  import CsvSpreadsheetView from './CsvSpreadsheetView.svelte'
  import { fileViewerKindForPath } from '@client/lib/fileViewerKind.js'
  import type { SurfaceContext } from '@client/router.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'

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
  /** Path returned by `/api/files/read` (canonical) — use for `.csv` / `.tsv` detection when present. */
  let resolvedPathFromApi = $state<string | undefined>(undefined)

  /** Prefer server-resolved path so symlink / normalization does not change the chosen viewer. */
  const pathForViewer = $derived((resolvedPathFromApi ?? initialPath ?? '').trim())

  const viewerKind = $derived(
    pathForViewer.length > 0 ? fileViewerKindForPath(pathForViewer) : 'plaintext',
  )
  const useSpreadsheetViewer = $derived(viewerKind === 'spreadsheet')

  const fileLoadLatest = createAsyncLatest({ abortPrevious: true })

  function titleFromPath(p: string) {
    const parts = p.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? p
  }

  $effect(() => {
    if (initialPath) void load(initialPath)
  })

  async function load(p: string) {
    const { token, signal } = fileLoadLatest.begin()
    loading = true
    err = ''
    bodyText = ''
    resolvedPathFromApi = undefined
    onContextChange?.({ type: 'file', path: p, title: titleFromPath(p) })
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(p)}`, { signal })
      if (fileLoadLatest.isStale(token)) return
      const j = (await res.json().catch(() => ({}))) as { error?: string; bodyText?: string; path?: string }
      if (!res.ok) {
        err = typeof j.error === 'string' ? j.error : `HTTP ${res.status}`
        return
      }
      bodyText = typeof j.bodyText === 'string' ? j.bodyText : ''
      resolvedPathFromApi = typeof j.path === 'string' ? j.path : p
      const showPath = resolvedPathFromApi
      onContextChange?.({ type: 'file', path: p, title: titleFromPath(showPath) })
    } catch (e) {
      if (fileLoadLatest.isStale(token) || isAbortError(e)) return
      err = e instanceof Error ? e.message : String(e)
    } finally {
      if (!fileLoadLatest.isStale(token)) loading = false
    }
  }
</script>

<div class="file-view" class:spreadsheet-mode={useSpreadsheetViewer && !loading && !err}>
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if err}
    <p class="err">{err}</p>
  {:else if useSpreadsheetViewer}
    <CsvSpreadsheetView text={bodyText} path={pathForViewer} />
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
