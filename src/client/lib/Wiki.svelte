<script lang="ts">
  type WikiFile = { path: string; name: string }
  type GitStatus = { sha: string | null; date: string | null; dirty: number; changedFiles: string[]; ahead: number; behind: number }

  let {
    initialPath,
    refreshKey = 0,
    onNavigate,
  }: {
    initialPath?: string
    refreshKey?: number
    onNavigate?: (_path: string | undefined) => void
  } = $props()

  let files = $state<WikiFile[]>([])
  let selected = $state<string | null>(null)
  let content = $state<string>('')
  let meta = $state<Record<string, string>>({})
  let loading = $state(false)

  // Header navigation search
  let headerSearch = $state('')
  let showSearch = $state(false)
  let selectedSearch = $state(0)

  // Git status
  let gitStatus = $state<GitStatus | null>(null)
  let showDirtyFiles = $state(false)

  async function loadFiles() {
    const res = await fetch('/api/wiki')
    files = await res.json()
  }

  async function loadGitStatus() {
    try {
      const res = await fetch('/api/wiki/git-status')
      gitStatus = await res.json()
    } catch { /* ignore */ }
  }

  async function openFile(path: string) {
    selected = path
    onNavigate?.(path)
    loading = true
    const res = await fetch(`/api/wiki/${encodeURIComponent(path)}`)
    const data = await res.json()
    meta = data.meta ?? {}
    content = renderWikiLinks(data.html)
    loading = false
  }

  function renderWikiLinks(html: string): string {
    return html.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
      const [path, label] = inner.split('|')
      const display = (label ?? path).trim()
      return `<a href="#" data-wiki="${path.trim()}" class="wiki-link">${display}</a>`
    })
  }

  function handleContentClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a[data-wiki]')
    if (!a) return
    e.preventDefault()
    const link = a.getAttribute('data-wiki')!
    const match = files.find(f =>
      f.path.replace(/\.md$/, '').toLowerCase() === link.toLowerCase()
    )
    if (match) openFile(match.path)
  }

  function filteredFiles(): WikiFile[] {
    if (!headerSearch) return files.slice(0, 15)
    const q = headerSearch.toLowerCase()
    return files.filter(f =>
      f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
    ).slice(0, 15)
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    const items = filteredFiles()
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedSearch = Math.min(selectedSearch + 1, items.length - 1); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectedSearch = Math.max(selectedSearch - 1, 0); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const f = items[selectedSearch]
      if (f) { openFile(f.path); showSearch = false; headerSearch = '' }
      return
    }
    if (e.key === 'Escape') { showSearch = false; return }
    selectedSearch = 0
  }

  function selectSearchFile(path: string) {
    openFile(path)
    showSearch = false
    headerSearch = ''
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function parseTags(tagsStr: string): string[] {
    return tagsStr.replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean)
  }

  let initialized = false

  $effect(() => {
    void refreshKey // re-run when refreshKey changes
    loadGitStatus()
    loadFiles().then(() => {
      if (initialized) return
      initialized = true
      if (initialPath) {
        const match = files.find(f => f.path === initialPath)
        if (match) openFile(match.path)
      } else {
        const index = files.find(f => f.name === '_index' && !f.path.includes('/'))
        if (index) openFile(index.path)
      }
    })
  })
</script>

<div class="wiki">
  <div class="wiki-header">
    <div class="search-wrap">
      <input
        type="text"
        class="header-search"
        placeholder="Go to file..."
        bind:value={headerSearch}
        onfocus={() => { showSearch = true; selectedSearch = 0 }}
        onblur={() => setTimeout(() => { showSearch = false }, 150)}
        oninput={() => { selectedSearch = 0 }}
        onkeydown={handleSearchKeydown}
      />
      {#if showSearch}
        <div class="search-dropdown">
          {#each filteredFiles() as f, i}
            <button
              class="search-item"
              class:selected={i === selectedSearch}
              onmousedown={(e) => { e.preventDefault(); selectSearchFile(f.path) }}
            >{f.path}</button>
          {:else}
            <div class="search-empty">No files found</div>
          {/each}
        </div>
      {/if}
    </div>

    {#if gitStatus}
      <div class="git-indicators">
        {#if gitStatus.dirty > 0}
          <div class="dirty-wrap">
            <button
              class="dirty-count"
              title="{gitStatus.dirty} file{gitStatus.dirty === 1 ? '' : 's'} with uncommitted changes"
              onclick={() => { showDirtyFiles = !showDirtyFiles }}
            >{gitStatus.dirty}</button>
            {#if showDirtyFiles}
              <div class="dirty-dropdown">
                {#each gitStatus.changedFiles as file}
                  <button
                    class="dirty-file-item"
                    class:active={selected === file}
                    onmousedown={(e) => { e.preventDefault(); openFile(file); showDirtyFiles = false }}
                  >{file}</button>
                {:else}
                  <div class="dirty-file-item muted">No .md files changed</div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        {#if (gitStatus.ahead ?? 0) > 0}<span class="git-ahead" title="{gitStatus.ahead} unpushed">↑{gitStatus.ahead}</span>{/if}
        {#if (gitStatus.behind ?? 0) > 0}<span class="git-behind" title="{gitStatus.behind} to pull">↓{gitStatus.behind}</span>{/if}
      </div>
    {/if}

    {#if selected}
      <span class="current-path">{selected}</span>
    {/if}
  </div>

  <div class="content-area">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <article class="viewer" onclick={handleContentClick}>
      {#if loading}
        <p class="status">Loading...</p>
      {:else if content}
        {#if Object.keys(meta).length > 0}
          <div class="page-meta">
            {#if meta.updated}<span class="meta-date">{formatDate(meta.updated)}</span>{/if}
            {#if meta.updated && meta.tags}<span class="meta-sep">·</span>{/if}
            {#if meta.tags}{#each parseTags(meta.tags) as tag}<span class="meta-tag">{tag}</span>{/each}{/if}
          </div>
        {/if}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html content}
      {:else}
        <p class="status">Select a page from the search above</p>
      {/if}
    </article>
  </div>
</div>

<style>
  .wiki { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  /* ── header ──────────────────────────────────────────────── */
  .wiki-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }

  .search-wrap { flex: 1; position: relative; min-width: 0; }

  .header-search {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }
  .header-search:focus { outline: none; border-color: var(--accent); }

  .search-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    max-height: 240px;
    overflow-y: auto;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 100;
  }

  .search-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--text);
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .search-item:hover, .search-item.selected { background: var(--accent-dim); color: var(--accent); }
  .search-empty { padding: 8px 12px; font-size: 12px; color: var(--text-2); }

  .git-indicators { display: flex; align-items: center; gap: 4px; font-size: 12px; flex-shrink: 0; }

  .dirty-wrap { position: relative; }
  .dirty-count {
    color: #f5a623;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 2px 5px;
    border-radius: 4px;
  }
  .dirty-count:hover { background: rgba(245, 166, 35, 0.15); }

  .dirty-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 220px;
    max-height: 240px;
    overflow-y: auto;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 100;
  }
  .dirty-file-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    font-size: 12px;
    font-family: monospace;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dirty-file-item:hover, .dirty-file-item.active { background: var(--accent-dim); color: var(--accent); }
  .dirty-file-item.muted { color: var(--text-2); cursor: default; }

  .git-ahead { color: var(--text-2); }
  .git-behind { color: #e74c3c; }

  .current-path {
    font-size: 11px;
    color: var(--text-2);
    font-family: monospace;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* ── content ─────────────────────────────────────────────── */
  .content-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  .viewer { flex: 1; overflow-y: auto; padding: 24px 32px; max-width: 800px; }

  .status { color: var(--text-2); font-size: 14px; }

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

  @media (max-width: 768px) {
    .current-path { display: none; }
    .viewer { padding: 16px; }
  }
</style>
