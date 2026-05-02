<script lang="ts">
  import CsvSpreadsheetView from './CsvSpreadsheetView.svelte'
  import { renderMarkdownBody } from '@client/lib/markdown.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'
  import type { SurfaceContext } from '@client/router.js'

  let {
    id,
    source,
    onContextChange,
  }: {
    id: string
    source?: string
    onContextChange?: (_ctx: SurfaceContext) => void
  } = $props()

  let loading = $state(false)
  let err = $state('')
  let title = $state('')
  let body = $state('')
  let mime = $state('text/plain')
  let sourceKind = $state('')
  let resolvedId = $state('')

  const loadLatest = createAsyncLatest({ abortPrevious: true })

  const useSpreadsheetViewer = $derived.by(() => {
    const m = mime.toLowerCase()
    return (
      m.includes('csv') ||
      m.includes('tab-separated') ||
      m.includes('spreadsheet') ||
      m.includes('excel') ||
      m.endsWith('sheet')
    )
  })

  const spreadsheetPathForViewer = $derived.by(() => {
    const base = title.trim() || resolvedId.trim() || 'file'
    if (mime.toLowerCase().includes('tab')) return `${base}.tsv`
    return `${base}.csv`
  })

  $effect(() => {
    const raw = id?.trim()
    if (raw) void load(raw)
  })

  async function load(fileId: string) {
    const { token, signal } = loadLatest.begin()
    loading = true
    err = ''
    body = ''
    title = ''
    mime = 'text/plain'
    sourceKind = ''
    resolvedId = fileId
    onContextChange?.({
      type: 'indexed-file',
      id: fileId,
      title: '(loading)',
      sourceKind: '',
      ...(source?.trim() ? { source: source.trim() } : {}),
    })
    try {
      const q = new URLSearchParams({ id: fileId })
      if (source?.trim()) q.set('source', source.trim())
      const res = await fetch(`/api/files/indexed?${q}`, { signal })
      if (loadLatest.isStale(token)) return
      const j = (await res.json().catch(() => ({}))) as {
        error?: string
        title?: string
        body?: string
        mime?: string
        sourceKind?: string
        id?: string
      }
      if (!res.ok) {
        err = typeof j.error === 'string' ? j.error : `HTTP ${res.status}`
        return
      }
      title = typeof j.title === 'string' ? j.title : fileId
      body = typeof j.body === 'string' ? j.body : ''
      mime = typeof j.mime === 'string' ? j.mime : 'text/plain'
      sourceKind = typeof j.sourceKind === 'string' ? j.sourceKind : ''
      if (typeof j.id === 'string' && j.id.trim()) resolvedId = j.id.trim()
      onContextChange?.({
        type: 'indexed-file',
        id: resolvedId,
        title,
        sourceKind,
        ...(source?.trim() ? { source: source.trim() } : {}),
      })
    } catch (e) {
      if (loadLatest.isStale(token) || isAbortError(e)) return
      err = e instanceof Error ? e.message : String(e)
    } finally {
      if (!loadLatest.isStale(token)) loading = false
    }
  }
</script>

<div class="indexed-file-view">
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if err}
    <p class="err">{err}</p>
  {:else if useSpreadsheetViewer}
    <CsvSpreadsheetView text={body} path={spreadsheetPathForViewer} />
  {:else}
    <div class="md-wrap">
      {@html renderMarkdownBody(body)}
    </div>
  {/if}
</div>

<style>
  .indexed-file-view {
    height: 100%;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 12px 16px;
    box-sizing: border-box;
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
  .md-wrap {
    flex: 1;
    min-height: 0;
    font-size: 0.9rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .md-wrap :global(pre) {
    overflow-x: auto;
    padding: 8px;
background: var(--code-bg, rgba(0, 0, 0, 0.06));
    font-size: 0.82rem;
  }
</style>
