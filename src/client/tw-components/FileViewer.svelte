<script lang="ts">
  import { cn } from '@client/lib/cn.js'
  import CsvSpreadsheetView from '@tw-components/CsvSpreadsheetView.svelte'
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

  const isSpreadsheetMode = $derived(useSpreadsheetViewer && !loading && !err)
</script>

<div
  class={cn(
    'file-view box-border flex h-full min-h-0 min-w-0 flex-col px-4 py-3',
    isSpreadsheetMode ? 'spreadsheet-mode overflow-hidden' : 'overflow-auto',
  )}
>
  {#if loading}
    <p class="muted text-[0.9rem] text-muted">Loading…</p>
  {:else if err}
    <p class="err text-[0.9rem] text-[var(--error,#c44)]">{err}</p>
  {:else if useSpreadsheetViewer}
    <CsvSpreadsheetView text={bodyText} path={pathForViewer} />
  {:else}
    <div class="pre-wrap min-h-0 flex-1 overflow-auto">
      <pre
        class="body m-0 whitespace-pre-wrap [word-break:break-word] text-[0.85rem] leading-normal [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace]"
      >{bodyText}</pre>
    </div>
  {/if}
</div>
