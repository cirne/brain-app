<script lang="ts">
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

  type WikiFile = { path: string; name: string }

  import type { SurfaceContext } from '../router.js'

  let {
    initialPath,
    refreshKey = 0,
    streamingWrite = null as { path: string; body: string } | null,
    /** Live `edit` tool — spinner + “Editing…” while args stream / tool runs. */
    streamingEdit = null as { path: string; toolId: string } | null,
    onNavigate,
    onContextChange,
  }: {
    initialPath?: string
    refreshKey?: number
    /** Live markdown while agent streams `write` for this path (file may not exist yet). */
    streamingWrite?: { path: string; body: string } | null
    streamingEdit?: { path: string; toolId: string } | null
    onNavigate?: (_path: string | undefined) => void
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



  async function loadFiles() {
    const res = await fetch('/api/wiki')
    files = await res.json()
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
      } else if (selected) {
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
  <div class="wiki-toolbar" aria-label="Wiki page mode">
    <div class="wiki-mode-toggle" role="group" aria-label="View or edit markdown">
      <button
        type="button"
        class="wiki-mode-btn"
        class:active={pageMode === 'view'}
        onclick={() => void setPageMode('view')}
      >
        View
      </button>
      <button
        type="button"
        class="wiki-mode-btn"
        class:active={pageMode === 'edit'}
        disabled={!canEdit}
        onclick={() => void setPageMode('edit')}
      >
        Edit
      </button>
    </div>
    {#if saveState === 'saving'}
      <span class="wiki-save-hint" role="status">Saving…</span>
    {:else if saveState === 'saved'}
      <span class="wiki-save-hint" role="status">Saved</span>
    {:else if saveState === 'error'}
      <span class="wiki-save-hint wiki-save-err" role="status">Save failed</span>
    {/if}
  </div>
  <div class="content-area" class:content-area-edit={pageMode === 'edit' && canEdit}>
    {#if pageMode === 'edit' && canEdit}
      {#key selected}
        <div class="wiki-edit-wrap">
          <TipTapMarkdownEditor
            bind:this={wikiEditor}
            initialMarkdown={rawMarkdown}
            disabled={loading || streamBusy}
            onPersist={persistWikiMarkdown}
          />
        </div>
      {/key}
    {:else}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <article class="viewer" onclick={handleContentClick} use:upgradeWikiLinks={content}>
        {#if loading}
          <p class="status">Loading...</p>
        {:else if streamingWrite && selected && pathsMatchForStream(streamingWrite.path, selected) && streamingWrite.body}
          <p class="stream-label" role="status">Agent is writing…</p>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <div class="stream-md markdown">{@html renderMarkdown(streamingWrite.body.slice(0, 50000))}</div>
        {:else}
          {#if streamingEdit && selected && pathsMatchForStream(streamingEdit.path, selected)}
            <p class="stream-label stream-editing" role="status">
              <svg class="stream-spin" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Editing…
            </p>
          {/if}
          {#if content}
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

  .wiki-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
  }

  .wiki-mode-toggle {
    display: inline-flex;
    border-radius: 8px;
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .wiki-mode-btn {
    appearance: none;
    border: none;
    margin: 0;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    background: var(--bg);
    color: var(--text-2);
  }

  .wiki-mode-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-3);
  }

  .wiki-mode-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .wiki-mode-btn.active {
    background: var(--accent-muted, var(--bg-3));
    color: var(--text);
  }

  .wiki-save-hint {
    font-size: 12px;
    color: var(--text-2);
  }

  .wiki-save-err {
    color: var(--danger, #c44);
  }

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
  .stream-md {
    font-size: 14px;
    line-height: 1.6;
  }
  .stream-md :global(h1) { font-size: 1.5em; margin: 0.6em 0 0.35em; }
  .stream-md :global(h2) { font-size: 1.25em; margin: 0.8em 0 0.3em; }
  .stream-md :global(p) { margin: 0 0 0.65em; }
  .stream-md :global(pre) { background: var(--bg-3); padding: 10px 12px; border-radius: 6px; overflow-x: auto; }

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

  .viewer :global(h1) { font-size: 1.6em; margin-bottom: 0.5em; }
  .viewer :global(h2) { font-size: 1.3em; margin: 1.2em 0 0.4em; }
  .viewer :global(h3) { font-size: 1.1em; margin: 1em 0 0.3em; }
  .viewer :global(p)  { margin-bottom: 0.8em; }
  .viewer :global(ul), .viewer :global(ol) { margin: 0.5em 0 0.8em 1.4em; }
  .viewer :global(code) { background: var(--bg-3); padding: 0.1em 0.4em; border-radius: 3px; font-size: 0.88em; }
  .viewer :global(pre) { background: var(--bg-3); padding: 12px 16px; border-radius: 6px; overflow-x: auto; margin-bottom: 1em; }
  .viewer :global(pre code) { background: none; padding: 0; }
  .viewer :global(blockquote) { border-left: 3px solid var(--border); padding-left: 12px; color: var(--text-2); }
  .viewer :global(hr) { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }
  .viewer :global(table) { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
  .viewer :global(th), .viewer :global(td) { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
  .viewer :global(th) { background: var(--bg-3); }
  .viewer :global(a) { color: var(--accent); }
  .viewer :global(a.wiki-link) { color: var(--accent); text-decoration: underline; cursor: pointer; }
  .viewer :global(a.wiki-link .wfn-title-row) { color: inherit; }
  .viewer :global(a.wiki-link .wfn-name) { text-decoration: underline; }

  @media (max-width: 768px) {
    .viewer { padding: 16px; }
    .content-area { overflow-x: hidden; }
  }
</style>
