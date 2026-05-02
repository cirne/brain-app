<script lang="ts">
  import { getContext } from 'svelte'
  import { Loader2 } from 'lucide-svelte'
  import { mount, unmount } from 'svelte'
  import { cn } from '@client/lib/cn.js'
  import WikiFileName from '@components/WikiFileName.svelte'
  import TipTapMarkdownEditor from '@components/TipTapMarkdownEditor.svelte'
  import WikiShareDialog from '@components/WikiShareDialog.svelte'
  import {
    encodeWikiPathSegmentsForUrl,
    normalizeWikiPathForMatch,
    resolveWikiLinkToFilePath,
    transformWikiPageHtml,
  } from '@client/lib/wikiPageHtml.js'
  import { wikiPathForReadToolArg } from '@client/lib/cards/contentCards.js'
  import { renderMarkdown } from '@client/lib/markdown.js'
  import '../styles/wiki/wikiMarkdown.css'
  import {
    WIKI_SLIDE_HEADER,
    type SetWikiSlideHeader,
  } from '@client/lib/wikiSlideHeaderContext.js'
  import { emit } from '@client/lib/app/appEvents.js'
  import type { SurfaceContext } from '@client/router.js'
  import {
    countOutgoingSharesForVaultPath,
    parseUnifiedWikiBrowsePath,
    type WikiFileRow,
    type WikiOwnedShareRef,
  } from '@client/lib/wikiDirListModel.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'

  type WikiFile = WikiFileRow

  let {
    initialPath,
    refreshKey = 0,
    shareOwner,
    sharePrefix,
    shareHandle,
    streamingWrite = null as { path: string; body: string } | null,
    /** Live `edit` tool — spinner + “Editing…” while args stream / tool runs. */
    streamingEdit = null as { path: string; toolId: string } | null,
    onNavigate,
    onNavigateToDir: _onNavigateToDir,
    onContextChange,
  }: {
    initialPath?: string
    refreshKey?: number
    /** Read-only shared wiki: owner tenant id + list prefix (e.g. `trips/`). */
    shareOwner?: string
    sharePrefix?: string
    /** When set, use `/api/wiki/shared-by-handle/...` (canonical with path URLs). */
    shareHandle?: string
    /** Live markdown while agent streams `write` for this path (file may not exist yet). */
    streamingWrite?: { path: string; body: string } | null
    streamingEdit?: { path: string; toolId: string } | null
    onNavigate?: (_path: string | undefined) => void
    /** Open folder browser (`/wiki-dir/…`) instead of picking `_index.md` / first file. */
    onNavigateToDir?: (_dirPath: string) => void
    onContextChange?: (_ctx: SurfaceContext) => void
  } = $props()

  const routeBrowseParse = $derived(parseUnifiedWikiBrowsePath((initialPath ?? '').trim().replace(/^\.\/+/, '')))
  const effectiveShareHandle = $derived(
    (shareHandle?.trim() || routeBrowseParse.shareHandle?.trim() || '').replace(/^@+/, ''),
  )
  const sharedMode = $derived(
    Boolean(
      effectiveShareHandle ||
        (shareOwner?.trim() && sharePrefix?.trim()),
    ),
  )

  function wikiFileUrl(rel: string): string {
    const sh = effectiveShareHandle.trim()
    if (sh && sharedMode) {
      return `/api/wiki/shared-by-handle/${encodeURIComponent(sh)}/${encodeWikiPathSegmentsForUrl(rel)}`
    }
    const so = shareOwner?.trim()
    if (sharedMode && so) {
      return `/api/wiki/shared/${encodeURIComponent(so)}/${encodeWikiPathSegmentsForUrl(rel)}`
    }
    return `/api/wiki/${encodeWikiPathSegmentsForUrl(rel)}`
  }

  function pathsMatchForStream(streamPath: string, currentSelected: string | null): boolean {
    if (!currentSelected) return false
    const a = normalizeWikiPathForMatch(wikiPathForReadToolArg(streamPath))
    const b = normalizeWikiPathForMatch(wikiPathForReadToolArg(currentSelected))
    return a === b
  }

  let files = $state<WikiFile[]>([])
  /** Grant rows from `GET /api/wiki` (own wiki only) — one ref per collaborator. */
  let ownedShares = $state<WikiOwnedShareRef[]>([])
  let selected = $state<string | null>(null)
  let content = $state<string>('')
  let rawMarkdown = $state('')
  let meta = $state<Record<string, string>>({})
  let loading = $state(false)
  /** Last open succeeded (file exists); enables Edit. */
  let pageLoadedOk = $state(false)
  let pageMode = $state<'view' | 'edit'>('view')
  type SaveState = 'idle' | 'saving' | 'saved' | 'error'
  let saveState = $state<SaveState>('idle')
  let wikiEditor = $state<{ flushSave: () => Promise<void> } | null>(null)
  let shareDialogOpen = $state(false)

  /** Supersedes in-flight page GETs (open + server refresh) so rapid nav cannot mix HTML. */
  const wikiPageLatest = createAsyncLatest({ abortPrevious: true })

  const streamBusy = $derived(
    Boolean(
      (streamingWrite && selected && pathsMatchForStream(streamingWrite.path, selected)) ||
        (streamingEdit && selected && pathsMatchForStream(streamingEdit.path, selected)),
    ),
  )

  const canEdit = $derived(Boolean(selected && pageLoadedOk && !streamBusy && !loading && !sharedMode))

  const canSharePage = $derived(
    Boolean(selected && pageLoadedOk && !streamBusy && !loading && !sharedMode && selected.endsWith('.md')),
  )

  const shareAudienceCount = $derived(
    selected && !sharedMode ? countOutgoingSharesForVaultPath(selected, ownedShares) : 0,
  )

  const registerWikiHeader = getContext<SetWikiSlideHeader | undefined>(WIKI_SLIDE_HEADER)
  $effect(() => {
    registerWikiHeader?.({
      pageMode,
      canEdit,
      saveState,
      setPageMode: (m: 'view' | 'edit') => void setPageMode(m),
      canShare: canSharePage,
      onOpenShare: () => {
        shareDialogOpen = true
      },
      shareTargetLabel: selected ?? undefined,
      shareAudienceCount: shareAudienceCount > 0 ? shareAudienceCount : undefined,
      sharedIncoming: sharedMode,
    })
    return () => registerWikiHeader?.(null)
  })

  async function loadFiles() {
    const sh = effectiveShareHandle.trim()
    const so = shareOwner?.trim()
    const sp = sharePrefix?.trim()
    let listUrl = '/api/wiki'
    if (sharedMode && sh) {
      listUrl =
        sp && sp.length > 0
          ? `/api/wiki/shared-by-handle/${encodeURIComponent(sh)}?prefix=${encodeURIComponent(sp)}`
          : `/api/wiki/shared-by-handle/${encodeURIComponent(sh)}`
    } else if (sharedMode && so && sp) {
      listUrl = `/api/wiki/shared/${encodeURIComponent(so)}?prefix=${encodeURIComponent(sp)}`
    }
    const res = await fetch(listUrl)
    let data: unknown
    try {
      data = await res.json()
    } catch {
      data = null
    }
    const parsed = parseWikiListApiBody(data)
    files = parsed.files
    ownedShares =
      !sharedMode && listUrl === '/api/wiki' ? parsed.shares.owned : []
  }

  async function refreshRenderedFromServer() {
    if (!selected) return
    const { token, signal } = wikiPageLatest.begin()
    const pathKey = selected
    try {
      const res = await fetch(wikiFileUrl(pathKey), { signal })
      if (wikiPageLatest.isStale(token)) return
      if (!res.ok) return
      const data = await res.json()
      if (wikiPageLatest.isStale(token)) return
      meta = data.meta ?? {}
      content = transformWikiPageHtml(data.html)
      rawMarkdown = data.raw ?? ''
    } catch (e) {
      if (!wikiPageLatest.isStale(token) && !isAbortError(e)) throw e
    }
  }

  async function persistWikiMarkdown(md: string) {
    if (!selected) return
    saveState = 'saving'
    try {
      const res = await fetch(wikiFileUrl(selected), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: md }),
      })
      if (!res.ok) {
        saveState = 'error'
        return
      }
      rawMarkdown = md
      emit({ type: 'wiki:mutated', source: 'user' })
      await refreshRenderedFromServer()
      saveState = 'saved'
      setTimeout(() => {
        if (saveState === 'saved') saveState = 'idle'
      }, 1600)
    } catch {
      saveState = 'error'
    }
  }

  async function setPageMode(mode: 'view' | 'edit') {
    if (mode === 'view' && pageMode === 'edit') {
      await wikiEditor?.flushSave()
      await refreshRenderedFromServer()
    }
    pageMode = mode
  }

  async function openFile(path: string) {
    if (pageMode === 'edit' && wikiEditor) {
      await wikiEditor.flushSave()
    }
    const { token, signal } = wikiPageLatest.begin()
    selected = path
    onNavigate?.(path)
    loading = true
    pageMode = 'view'
    try {
      const url = wikiFileUrl(path)
      const res = await fetch(url, { signal })
      if (wikiPageLatest.isStale(token)) return
      if (!res.ok) {
        meta = {}
        content = ''
        rawMarkdown = ''
        pageLoadedOk = false
        const title = path.replace(/\.md$/, '').split('/').pop() ?? path
        onContextChange?.({ type: 'wiki', path, title })
        return
      }
      const data = await res.json()
      if (wikiPageLatest.isStale(token)) return
      meta = data.meta ?? {}
      content = transformWikiPageHtml(data.html)
      rawMarkdown = data.raw ?? ''
      pageLoadedOk = true
      const title = meta.title ?? path.replace(/\.md$/, '').split('/').pop() ?? path
      onContextChange?.({ type: 'wiki', path, title })
    } catch (e) {
      if (wikiPageLatest.isStale(token) || isAbortError(e)) return
      meta = {}
      content = ''
      rawMarkdown = ''
      pageLoadedOk = false
      const title = path.replace(/\.md$/, '').split('/').pop() ?? path
      onContextChange?.({ type: 'wiki', path, title })
    } finally {
      if (!wikiPageLatest.isStale(token)) loading = false
    }
  }

  $effect(() => {
    if (streamBusy) pageMode = 'view'
  })

  /** Clicks on link text often set `event.target` to a Text node — it has no `.closest()`. */
  function handleContentClick(e: MouseEvent) {
    const start =
      e.target instanceof Element ? e.target : ((e.target as Node | null)?.parentElement ?? null)
    if (!start) return

    const a = start.closest('a')
    if (!a) return

    e.preventDefault()

    let ref = a.getAttribute('data-wiki')?.trim() ?? ''
    if (!ref) {
      const href = (a.getAttribute('href') ?? '').trim()
      if (
        href &&
        href !== '#' &&
        !/^https?:\/\//i.test(href) &&
        !/^mailto:/i.test(href) &&
        !/^wiki:/i.test(href) &&
        !/^date:/i.test(href) &&
        !href.includes('://')
      ) {
        const pathOnly = href.split('#')[0].replace(/^\//, '').replace(/^\.\//, '')
        if (pathOnly) ref = wikiPathForReadToolArg(pathOnly)
      }
    }
    if (!ref) {
      const href = (a.getAttribute('href') ?? '').trim()
      if (href === '#' || href === '') {
        const label = a.textContent?.trim() ?? ''
        if (label) {
          ref = wikiPathForReadToolArg(
            label.includes('/') ? label : label.toLowerCase().replace(/\s+/g, '-'),
          )
        }
      }
    }
    if (!ref) return

    const path = resolveWikiLinkToFilePath(ref, files)
    if (path) void openFile(path)
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function parseTags(tagsStr: string): string[] {
    return tagsStr.replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean)
  }

  /** Replace wiki-link text with mounted WikiFileName components. */
  function upgradeWikiLinks(node: HTMLElement) {
    let instances: ReturnType<typeof mount>[] = []

    function run() {
      for (const inst of instances) unmount(inst)
      instances = []

      for (const a of node.querySelectorAll<HTMLAnchorElement>('a[data-wiki]')) {
        const path = a.getAttribute('data-wiki')!
        a.textContent = ''
        instances.push(mount(WikiFileName, { target: a, props: { path } }))
      }
    }

    run()

    return {
      update() { run() },
      destroy() { for (const inst of instances) unmount(inst) },
    }
  }

  /** Supersede in-flight `loadFiles` + open so rapid `refreshKey` bumps cannot commit stale landing. */
  let wikiLoadSerial = 0

  /** Tracks the previous `refreshKey` to detect external refreshes (e.g. agent edits). */
  const prevRefreshKeyRef = { current: 0 }

  /** Path + shared-by-handle context — same path can mean vault vs shared API; must re-open when context catches up. */
  const prevWikiLoadIdentityRef = { current: '' }

  $effect(() => {
    const currentRefreshKey = refreshKey
    void shareOwner
    void sharePrefix
    void shareHandle
    const refreshKeyChanged = currentRefreshKey !== prevRefreshKeyRef.current
    prevRefreshKeyRef.current = currentRefreshKey
    const pathFromRoute = (initialPath ?? '').trim()
    const listKeyParse = parseUnifiedWikiBrowsePath(pathFromRoute.replace(/^\.\/+/, ''))
    const vaultRelForList =
      listKeyParse.vaultRelPath.trim().length > 0 ? listKeyParse.vaultRelPath : pathFromRoute
    const loadIdentity = [
      pathFromRoute,
      shareHandle?.trim() ?? '',
      shareOwner?.trim() ?? '',
      sharePrefix?.trim() ?? '',
    ].join('\0')
    const loadIdentityChanged = loadIdentity !== prevWikiLoadIdentityRef.current
    prevWikiLoadIdentityRef.current = loadIdentity
    const serial = ++wikiLoadSerial

    void (async () => {
      await loadFiles()
      if (serial !== wikiLoadSerial) return

      if (pathFromRoute) {
        const match = files.find(
          (f) => f.path === vaultRelForList || f.path === pathFromRoute,
        )
        if (match) {
          if (match.path !== selected || loadIdentityChanged) {
            void openFile(match.path)
          } else if (refreshKeyChanged && pageMode !== 'edit') {
            void refreshRenderedFromServer()
          }
        } else if (vaultRelForList !== selected || loadIdentityChanged) {
          void openFile(vaultRelForList || pathFromRoute)
        } else if (refreshKeyChanged && pageMode !== 'edit') {
          void refreshRenderedFromServer()
        }
        return
      }

      if (selected && pageMode !== 'edit') {
        void openFile(selected)
        return
      }
    })()
  })
</script>

<div class="wiki flex min-h-0 flex-col overflow-hidden h-full">
  <WikiShareDialog
    open={shareDialogOpen}
    pathPrefix={selected ?? ''}
    targetKind="file"
    onDismiss={() => {
      shareDialogOpen = false
    }}
    onSharesChanged={() => void loadFiles()}
  />
  <div
    class={cn(
      'content-area min-h-0 min-w-0 flex-1 overflow-y-auto max-md:overflow-x-hidden',
      pageMode === 'edit' && canEdit && 'content-area-edit flex flex-col overflow-hidden',
    )}
  >
    {#if pageMode === 'edit' && canEdit}
      {#key selected}
        <div class="wiki-edit-wrap flex min-h-0 flex-1 flex-col">
          <TipTapMarkdownEditor
            bind:this={wikiEditor}
            initialMarkdown={rawMarkdown}
            disabled={loading || streamBusy}
            autoPersist={false}
            onPersist={persistWikiMarkdown}
          />
        </div>
      {/key}
    {:else}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <article
        class="viewer wiki-md mx-auto box-border w-full max-w-chat px-[clamp(1rem,4%,2.5rem)] py-6 max-md:p-4"
        onclick={handleContentClick}
        use:upgradeWikiLinks={content}
      >
        {#if loading}
          <p class="status text-sm text-muted">Loading...</p>
        {:else if streamingWrite && selected && pathsMatchForStream(streamingWrite.path, selected) && streamingWrite.body}
          <p class="stream-label m-0 mb-3 text-xs font-semibold text-accent" role="status">Agent is writing…</p>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <div class="markdown">{@html renderMarkdown(streamingWrite.body.slice(0, 50000))}</div>
        {:else}
          {#if streamingEdit && selected && pathsMatchForStream(streamingEdit.path, selected)}
            <p
              class="stream-label stream-editing m-0 mb-3 flex items-center gap-2 text-xs font-semibold text-accent"
              role="status"
            >
              <span
                class="stream-spin inline-flex shrink-0 animate-[wiki-stream-spin_1s_linear_infinite] items-center [line-height:0]"
                aria-hidden="true"
              >
                <Loader2 size={12} strokeWidth={2.5} />
              </span>
              Editing…
            </p>
          {/if}
          {#if content}
            {#if Object.keys(meta).length > 0}
              <div
                class="page-meta mb-[1.2em] flex flex-wrap items-center gap-1 text-[11px] text-muted"
              >
                {#if meta.updated}<span class="meta-date">{formatDate(meta.updated)}</span>{/if}
                {#if meta.updated && meta.tags}<span class="meta-sep opacity-50">·</span>{/if}
                {#if meta.tags}{#each parseTags(meta.tags) as tag (tag)}<span
                      class="meta-tag bg-surface-3 px-1.5 py-px text-[11px]"
                      >{tag}</span
                    >{/each}{/if}
              </div>
            {/if}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html content}
          {:else if streamingEdit && selected && pathsMatchForStream(streamingEdit.path, selected)}
            <p class="status text-sm text-muted">Loading current page…</p>
          {:else}
            <p class="status text-sm text-muted">No page selected</p>
          {/if}
        {/if}
      </article>
    {/if}
  </div>
</div>

<style>
  @keyframes wiki-stream-spin {
    to { transform: rotate(360deg); }
  }
</style>
