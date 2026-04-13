<script lang="ts">
  type WikiFile = { path: string; name: string }

  let {
    onChatAbout,
  }: {
    onChatAbout?: (path: string) => void
  } = $props()

  let files = $state<WikiFile[]>([])
  let selected = $state<string | null>(null)
  let content = $state<string>('')
  let loading = $state(false)
  let searchQuery = $state('')
  let sidebarOpen = $state(true)

  async function loadFiles() {
    const res = await fetch('/api/wiki')
    files = await res.json()
  }

  async function openFile(path: string) {
    selected = path
    loading = true
    const res = await fetch(`/api/wiki/${encodeURIComponent(path)}`)
    const data = await res.json()
    content = data.html
    loading = false
    if (window.innerWidth < 768) sidebarOpen = false
  }

  function filteredFiles(): WikiFile[] {
    if (!searchQuery) return files
    const q = searchQuery.toLowerCase()
    return files.filter(f =>
      f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
    )
  }

  function chatAboutThis() {
    if (selected && onChatAbout) onChatAbout(selected)
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen
  }

  function fileTree(): Map<string, WikiFile[]> {
    const tree = new Map<string, WikiFile[]>()
    for (const f of filteredFiles()) {
      const parts = f.path.split('/')
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
      if (!tree.has(dir)) tree.set(dir, [])
      tree.get(dir)!.push(f)
    }
    return tree
  }

  $effect(() => { loadFiles() })
</script>

<div class="wiki">
  <aside class="sidebar" class:open={sidebarOpen}>
    <div class="sidebar-header">
      <input
        type="text"
        class="search-input"
        placeholder="Filter files..."
        bind:value={searchQuery}
      />
    </div>
    <div class="sidebar-inner">
      {#each [...fileTree()] as [dir, dirFiles]}
        {#if dir}
          <div class="dir-label">{dir}/</div>
        {/if}
        {#each dirFiles as f}
          <button
            class="file-item"
            class:active={selected === f.path}
            class:nested={!!dir}
            onclick={() => openFile(f.path)}
          >
            {f.name}
          </button>
        {/each}
      {/each}
    </div>
  </aside>

  <div class="content-area">
    <div class="content-header">
      <button class="toggle-sidebar" onclick={toggleSidebar}>
        {sidebarOpen ? '<' : '>'}
      </button>
      {#if selected}
        <span class="file-path">{selected}</span>
        {#if onChatAbout}
          <button class="chat-btn" onclick={chatAboutThis}>Chat about this</button>
        {/if}
      {/if}
    </div>

    <article class="viewer">
      {#if loading}
        <p class="status">Loading...</p>
      {:else if content}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html content}
      {:else}
        <p class="status">Select a page from the sidebar</p>
      {/if}
    </article>
  </div>
</div>

<style>
  .wiki { display: flex; height: 100%; overflow: hidden; }

  .sidebar {
    width: var(--sidebar-w);
    border-right: 1px solid var(--border);
    flex-shrink: 0;
    overflow-y: auto;
    background: var(--bg-2);
    display: flex;
    flex-direction: column;
    transition: margin-left 0.2s;
  }
  .sidebar:not(.open) { margin-left: calc(-1 * var(--sidebar-w)); }

  .sidebar-header {
    padding: 8px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search-input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 13px;
  }
  .search-input:focus { outline: none; border-color: var(--accent); }

  .sidebar-inner { padding: 4px 0; overflow-y: auto; flex: 1; }

  .dir-label {
    padding: 8px 12px 2px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-2);
  }

  .file-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 5px 12px;
    font-size: 13px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .file-item.nested { padding-left: 24px; }
  .file-item:hover, .file-item.active { color: var(--text); background: var(--bg-3); }

  .content-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }

  .content-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }

  .toggle-sidebar { font-size: 12px; color: var(--text-2); padding: 4px; }

  .file-path {
    font-size: 12px;
    color: var(--text-2);
    font-family: monospace;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-btn {
    font-size: 12px;
    color: var(--accent);
    padding: 4px 10px;
    border: 1px solid var(--accent-dim);
    border-radius: 4px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .viewer { flex: 1; overflow-y: auto; padding: 24px 32px; max-width: 800px; }
  .status { color: var(--text-2); font-size: 14px; }

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

  @media (max-width: 768px) {
    .sidebar { position: absolute; z-index: 10; height: 100%; }
    .viewer { padding: 16px; }
  }
</style>
