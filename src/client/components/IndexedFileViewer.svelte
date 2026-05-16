<script lang="ts">
  import { ExternalLink } from '@lucide/svelte'
  import CsvSpreadsheetView from '@components/CsvSpreadsheetView.svelte'
  import { renderMarkdownBody } from '@client/lib/markdown.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'
  import type { SurfaceContext } from '@client/router.js'
  import { get } from 'svelte/store'
  import { t } from '@client/lib/i18n/index.js'
  import { formatDate } from '@client/lib/formatDate.js'
  import { cn } from '@client/lib/cn.js'

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
  let modifiedAt = $state('')
  /** Only opens when non-empty and validated as http(s). */
  let sourceAppUrl = $state('')

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

  const sourceLabel = $derived.by(() => {
    const tr = get(t)
    const k = sourceKind.trim()
    if (k === 'googleDrive') return tr('wiki.indexedFileViewer.sourceGoogleDrive')
    if (k === 'localDir') return tr('wiki.indexedFileViewer.sourceLocalFiles')
    return k || tr('wiki.indexedFileViewer.sourceIndexed')
  })

  const mimeSummary = $derived.by(() => {
    const m = mime.trim()
    if (!m || m === 'application/octet-stream') return ''
    if (m.startsWith('application/vnd.google-apps.')) {
      return m.replace(/^application\/vnd\.google-apps\./, '').replace(/-/g, ' ')
    }
    return m.startsWith('application/') ? m.slice('application/'.length) : m
  })

  const modifiedLine = $derived.by(() => {
    const raw = modifiedAt.trim()
    if (!raw) return ''
    const when = formatDate(raw)
    return get(t)('wiki.indexedFileViewer.modifiedLabel', { when })
  })

  const safeOpenHref = $derived.by((): string => {
    const u = sourceAppUrl.trim()
    if (!u.startsWith('https://') && !u.startsWith('http://')) return ''
    try {
      const parsed = new URL(u)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
      return parsed.href
    } catch {
      return ''
    }
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
    modifiedAt = ''
    sourceAppUrl = ''
    onContextChange?.({
      type: 'indexed-file',
      id: fileId,
      title: get(t)('wiki.indexedFileViewer.loadingTitle'),
      sourceKind: '',
      ...(source?.trim() ? { source: source.trim() } : {}),
    })
    try {
      const path = `/api/ripmail/entry/${encodeURIComponent(fileId)}`
      const url = source?.trim() ? `${path}?${new URLSearchParams({ source: source.trim() })}` : path
      const res = await fetch(url, { signal })
      if (loadLatest.isStale(token)) return
      const j = (await res.json().catch(() => ({}))) as {
        entryKind?: string
        error?: string
        title?: string
        body?: string
        mime?: string
        sourceKind?: string
        id?: string
        modifiedAt?: string
        sourceAppUrl?: string
      }
      if (!res.ok) {
        err =
          typeof j.error === 'string' && j.error.trim()
            ? j.error.trim()
            : get(t)('wiki.indexedFileViewer.loadFailedHttp', { status: String(res.status) })
        return
      }
      if (j.entryKind !== 'indexed-file') {
        err =
          j.entryKind === 'mail'
            ? get(t)('wiki.indexedFileViewer.wrongKindMail')
            : typeof j.error === 'string' && j.error.trim()
              ? j.error.trim()
              : get(t)('wiki.indexedFileViewer.notFound')
        return
      }
      title = typeof j.title === 'string' ? j.title : fileId
      body = typeof j.body === 'string' ? j.body : ''
      mime = typeof j.mime === 'string' ? j.mime : 'text/plain'
      sourceKind = typeof j.sourceKind === 'string' ? j.sourceKind : ''
      if (typeof j.id === 'string' && j.id.trim()) resolvedId = j.id.trim()
      modifiedAt = typeof j.modifiedAt === 'string' ? j.modifiedAt : ''
      const candidateUrl = typeof j.sourceAppUrl === 'string' ? j.sourceAppUrl.trim() : ''
      sourceAppUrl = candidateUrl
      onContextChange?.({
        type: 'indexed-file',
        id: resolvedId,
        title,
        sourceKind,
        ...(source?.trim() ? { source: source.trim() } : {}),
      })
    } catch (e) {
      if (loadLatest.isStale(token) || isAbortError(e)) return
      err =
        e instanceof Error && e.message.trim()
          ? e.message.trim()
          : get(t)('wiki.indexedFileViewer.loadFailedNetwork')
    } finally {
      if (!loadLatest.isStale(token)) loading = false
    }
  }
</script>

<div class="indexed-file-view box-border flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
  {#if loading}
    <p class="muted shrink-0 px-4 py-3 text-[0.9rem] text-muted">{$t('common.status.loading')}</p>
  {:else if err}
    <div class="shrink-0 border-b border-border bg-surface-2 px-4 py-3" role="alert">
      <p class="m-0 text-sm font-medium text-foreground">{$t('wiki.indexedFileViewer.errorTitle')}</p>
      <p class="err mt-1.5 m-0 text-[0.9rem] leading-snug text-[var(--error,#c44)]">{err}</p>
    </div>
  {:else}
    <header
      class="shrink-0 border-b border-border bg-surface-2 px-4 py-3"
      aria-label={$t('wiki.indexedFileViewer.documentHeadingAria')}
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h1 class="m-0 text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
            {title.trim() || resolvedId}
          </h1>
          <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
            <span>{sourceLabel}</span>
            {#if mimeSummary}
              <span class="opacity-50" aria-hidden="true">·</span>
              <span class="font-mono">{mimeSummary}</span>
            {/if}
            {#if modifiedLine}
              <span class="opacity-50" aria-hidden="true">·</span>
              <span>{modifiedLine}</span>
            {/if}
          </div>
        </div>
        {#if safeOpenHref}
          <a
            href={safeOpenHref}
            target="_blank"
            rel="noopener noreferrer"
            class={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground',
              'transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            )}
            title={$t('wiki.indexedFileViewer.openOriginalTitle')}
          >
            <ExternalLink size={14} strokeWidth={2} class="shrink-0 opacity-80" aria-hidden="true" />
            {$t('wiki.indexedFileViewer.openOriginal')}
          </a>
        {/if}
      </div>
    </header>
    <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
      {#if useSpreadsheetViewer}
        <CsvSpreadsheetView text={body} path={spreadsheetPathForViewer} />
      {:else}
        <div class="md-wrap min-h-0 flex-1 text-[0.9rem] leading-normal [overflow-wrap:anywhere]">
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html renderMarkdownBody(body)}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Markdown <pre> blocks rendered from server HTML need scoped overrides. */
  .md-wrap :global(pre) {
    overflow-x: auto;
    padding: 8px;
    background: var(--code-bg, rgba(0, 0, 0, 0.06));
    font-size: 0.82rem;
  }
</style>
