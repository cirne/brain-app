<script lang="ts">
  import { getContext } from 'svelte'
  import { mount, unmount } from 'svelte'
  import WikiFileName from './WikiFileName.svelte'
  import TipTapMarkdownEditor from './TipTapMarkdownEditor.svelte'
  import {
    encodeWikiPathSegmentsForUrl,
    normalizeWikiPathForMatch,
    resolveWikiLinkToFilePath,
    transformWikiPageHtml,
  } from './wikiPageHtml.js'
  import { wikiPathForReadToolArg } from './cards/contentCards.js'
  import { renderMarkdown } from './markdown.js'
  import './wikiMarkdownProse.css'
  import {
    WIKI_SLIDE_HEADER,
    type SetWikiSlideHeader,
  } from './wikiSlideHeaderContext.js'
  import { emit } from './app/appEvents.js'
  import type { SurfaceContext } from '../router.js'
  import type { WikiFileRow } from './wikiDirListModel.js'
  import { parseWikiFileListJson } from './wikiFileListResponse.js'

  type WikiFile = WikiFileRow

  let {
    initialPath,
    refreshKey = 0,
    streamingWrite = null as { path: string; body: string } | null,
    /** Live `edit` tool — spinner + “Editing…” while args stream / tool runs. */
    streamingEdit = null as { path: string; toolId: string } | null,
    onNavigate,
    onNavigateToDir,
    onContextChange,
  }: {
    initialPath?: string
    refreshKey?: number
    /** Live markdown while agent streams `write` for this path (file may not exist yet). */
    streamingWrite?: { path: string; body: string } | null
    streamingEdit?: { path: string; toolId: string } | null
    onNavigate?: (_path: string | undefined) => void
    /** Open folder browser (`/wiki-dir/…`) instead of picking `_index.md` / first file. */
    onNavigateToDir?: (_dirPath: string) => void
    onContextChange?: (_ctx: SurfaceContext) => void
  } = $props()

  function pathsMatchForStream(streamPath: string, currentSelected: string | null): boolean {
    if (!currentSelected) return false
    const a = normalizeWikiPathForMatch(wikiPathForReadToolArg(streamPath))
    const b = normalizeWikiPathForMatch(wikiPathForReadToolArg(currentSelected))
    return a === b
  }

  let files = $state<WikiFile[]>([])
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

  const streamBusy = $derived(
    Boolean(
      (streamingWrite && selected && pathsMatchForStream(streamingWrite.path, selected)) ||
        (streamingEdit && selected && pathsMatchForStream(streamingEdit.path, selected)),
    ),
  )

  const canEdit = $derived(Boolean(selected && pageLoadedOk && !streamBusy && !loading))

  const registerWikiHeader = getContext<SetWikiSlideHeader | undefined>(WIKI_SLIDE_HEADER)
  $effect(() => {
    registerWikiHeader?.({
      pageMode,
      canEdit,
      saveState,
      setPageMode: (m: 'view' | 'edit') => void setPageMode(m),
    })
    return () => registerWikiHeader?.(null)
  })

  async function loadFiles() {
    const res = await fetch('/api/wiki')
    let data: unknown
    try {
      data = await res.json()
    } catch {
      data = null
    }
    files = parseWikiFileListJson(data)
  }

  async function refreshRenderedFromServer() {
    if (!selected) return
    const res = await fetch(`/api/wiki/${encodeWikiPathSegmentsForUrl(selected)}`)
    if (!res.ok) return
    const data = await res.json()
    meta = data.meta ?? {}
    content = transformWikiPageHtml(data.html)
    rawMarkdown = data.raw ?? ''
  }

  async function persistWikiMarkdown(md: string) {
    if (!selected) return
    saveState = 'saving'
    try {
      const res = await fetch(`/api/wiki/${encodeWikiPathSegmentsForUrl(selected)}`, {
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
    selected = path
    onNavigate?.(path)
    loading = true
    pageMode = 'view'
    try {
      const res = await fetch(`/api/wiki/${encodeWikiPathSegmentsForUrl(path)}`)
      if (!res.ok) {
        meta = {}
        content = ''
        rawMarkdown = ''
        pageLoadedOk = false
        loading = false
        const title = path.replace(/\.md$/, '').split('/').pop() ?? path
        onContextChange?.({ type: 'wiki', path, title })
        return
      }
      const data = await res.json()
      meta = data.meta ?? {}
      content = transformWikiPageHtml(data.html)
      rawMarkdown = data.raw ?? ''
      pageLoadedOk = true
      loading = false
      const title = meta.title ?? path.replace(/\.md$/, '').split('/').pop() ?? path
      onContextChange?.({ type: 'wiki', path, title })
    } catch {
      meta = {}
      content = ''
      rawMarkdown = ''
      pageLoadedOk = false
      loading = false
      const title = path.replace(/\.md$/, '').split('/').pop() ?? path
      onContextChange?.({ type: 'wiki', path, title })
    }
  }

  $effect(() => {
    if (streamBusy) pageMode = 'view'
  })

  function handleContentClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a[data-wiki]')
    if (!a) return
    e.preventDefault()
    const link = a.getAttribute('data-wiki')!
    const path = resolveWikiLinkToFilePath(link, files)
    if (path) void openFile(path)
  }

  function folderLandingPath(folder: string): string | undefined {
    const idx = `${folder}/_index.md`
    if (files.some((f) => f.path === idx)) return idx
    const direct = files.find((f) => {
      if (!f.path.startsWith(folder + '/')) return false
      return !f.path.slice(folder.length + 1).includes('/')
    })
    return direct?.path
  }

  /** Breadcrumb segment index: 0 = first folder, …, last = current file (not clickable). */
  function navigateBreadcrumb(segmentIndex: number) {
    if (!selected) return
    const parts = selected.split('/').filter(Boolean)
    if (segmentIndex >= parts.length - 1) return
    const folder = parts.slice(0, segmentIndex + 1).join('/')
    if (onNavigateToDir) {
      onNavigateToDir(folder)
      return
    }
    const target = folderLandingPath(folder)
    if (target) void openFile(target)
  }

  const crumbLabels = $derived.by((): string[] => {
    if (!selected) return []
    return selected.split('/').filter(Boolean).map((p) => p.replace(/\.md$/, ''))
  })

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
      // Clean up previous mounts
      for (const inst of instances) unmount(inst)
      instances = []

      for (const a of node.querySelectorAll<HTMLAnchorElement>('a[data-wiki]')) {
        const path = a.getAttribute('data-wiki')!
        a.textContent = ''
        instances.push(mount(WikiFileName, { target: a, props: { path } }))
      }
    }

    // Run on initial mount and whenever content changes (via $effect in template)
    run()

    return {
      update() { run() },
      destroy() { for (const inst of instances) unmount(inst) },
    }
  }

  let initialized = false

  $effect(() => {
    void refreshKey
    loadFiles().then(() => {
      if (!initialized) {
        initialized = true
        if (initialPath) {
          const match = files.find(f => f.path === initialPath)
          if (match) void openFile(match.path)
          else void openFile(initialPath)
        } else {
          const index = files.find(f => f.name === '_index' && !f.path.includes('/'))
          if (index) void openFile(index.path)
        }
      } else if (selected && pageMode !== 'edit') {
        void openFile(selected)
      }
    })
  })

  // Navigate when initialPath changes while panel is already open
  $effect(() => {
    const path = initialPath
    if (!path || !initialized) return
    const match = files.find(f => f.path === path)
    if (match && path !== selected) void openFile(match.path)
    else if (!match && path !== selected) void openFile(path)
  })
</script>

<div class="wiki">
  <div class="content-area" class:content-area-edit={pageMode === 'edit' && canEdit}>
    {#if pageMode === 'edit' && canEdit}
      {#key selected}
        <div class="wiki-edit-wrap">
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
      <article class="viewer wiki-md-prose" onclick={handleContentClick} use:upgradeWikiLinks={content}>
        {#if loading}
          <p class="status">Loading...</p>
        {:else if streamingWrite && selected && pathsMatchForStream(streamingWrite.path, selected) && streamingWrite.body}
          <p class="stream-label" role="status">Agent is writing…</p>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <div class="markdown">{@html renderMarkdown(streamingWrite.body.slice(0, 50000))}</div>
        {:else}
          {#if streamingEdit && selected && pathsMatchForStream(streamingEdit.path, selected)}
            <p class="stream-label stream-editing" role="status">
              <svg class="stream-spin" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Editing…
            </p>
          {/if}
          {#if content}
            {#if pageLoadedOk && crumbLabels.length > 1}
              <nav class="wiki-crumb" aria-label="Page path">
                {#each crumbLabels as label, i}
                  {#if i > 0}<span class="wiki-crumb-sep">/</span>{/if}
                  {#if i < crumbLabels.length - 1}
                    <button
                      type="button"
                      class="wiki-crumb-btn"
                      onclick={() => navigateBreadcrumb(i)}
                    >{label}</button>
                  {:else}
                    <span class="wiki-crumb-current">{label}</span>
                  {/if}
                {/each}
              </nav>
            {/if}
            {#if Object.keys(meta).length > 0}
              <div class="page-meta">
                {#if meta.updated}<span class="meta-date">{formatDate(meta.updated)}</span>{/if}
                {#if meta.updated && meta.tags}<span class="meta-sep">·</span>{/if}
                {#if meta.tags}{#each parseTags(meta.tags) as tag}<span class="meta-tag">{tag}</span>{/each}{/if}
              </div>
            {/if}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html content}
          {:else if streamingEdit && selected && pathsMatchForStream(streamingEdit.path, selected)}
            <p class="status">Loading current page…</p>
          {:else}
            <p class="status">No page selected</p>
          {/if}
        {/if}
      </article>
    {/if}
  </div>
</div>

<style>
  .wiki { display: flex; flex-direction: column; height: 100%; overflow: hidden; min-height: 0; }

  /* ── content ─────────────────────────────────────────────── */
  .content-area { flex: 1; overflow-y: auto; min-width: 0; min-height: 0; }

  .content-area-edit {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .wiki-edit-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .viewer {
    max-width: var(--chat-column-max);
    width: 100%;
    margin: 0 auto;
    padding: 24px clamp(16px, 4%, 40px);
    box-sizing: border-box;
  }

  .status { color: var(--text-2); font-size: 14px; }

  .stream-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    margin: 0 0 12px;
  }
  .stream-editing {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stream-spin {
    flex-shrink: 0;
    animation: wiki-stream-spin 1s linear infinite;
  }
  @keyframes wiki-stream-spin {
    to { transform: rotate(360deg); }
  }
  .wiki-crumb {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    margin-bottom: 10px;
    font-size: 12px;
    color: var(--text-2);
  }
  .wiki-crumb-sep {
    opacity: 0.45;
    user-select: none;
  }
  .wiki-crumb-btn {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .wiki-crumb-btn:hover {
    color: var(--text);
  }
  .wiki-crumb-current {
    color: var(--text-2);
    font-weight: 500;
  }
  .page-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 1.2em;
    font-size: 11px;
    color: var(--text-2);
  }
  .meta-sep { opacity: 0.5; }
  .meta-tag { background: var(--bg-3); border-radius: 3px; padding: 1px 6px; font-size: 11px; }

  @media (max-width: 768px) {
    .viewer { padding: 16px; }
    .content-area { overflow-x: hidden; }
  }
</style>
