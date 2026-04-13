<script lang="ts">
  import { navigate } from '../router.js'

  type WikiFile = { path: string; name: string }

  let {
    initialPath,
    onChatAbout,
    onNavigate,
  }: {
    initialPath?: string
    onChatAbout?: (_path: string, _message: string) => void
    onNavigate?: (_path: string | undefined) => void
  } = $props()

  let files = $state<WikiFile[]>([])
  let selected = $state<string | null>(null)
  let content = $state<string>('')
  let meta = $state<Record<string, string>>({})
  let loading = $state(false)
  let searchQuery = $state('')
  let sidebarOpen = $state(true)
  let chatInput = $state('')
  let chatInputEl = $state<HTMLInputElement | undefined>(undefined)
  let showMentions = $state(false)
  let mentionFilter = $state('')
  let mentionStart = $state(-1)
  let selectedMention = $state(0)

  async function loadFiles() {
    const res = await fetch('/api/wiki')
    files = await res.json()
  }

  async function openFile(path: string) {
    selected = path
    navigate({ tab: 'wiki', path })
    onNavigate?.(path)
    loading = true
    const res = await fetch(`/api/wiki/${encodeURIComponent(path)}`)
    const data = await res.json()
    meta = data.meta ?? {}
    content = renderWikiLinks(data.html)
    loading = false
    if (window.innerWidth < 768) sidebarOpen = false
  }

  // Convert [[path]] and [[path|label]] to clickable links
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
    // Case-insensitive match against known files (path without .md extension)
    const match = files.find(f =>
      f.path.replace(/\.md$/, '').toLowerCase() === link.toLowerCase()
    )
    if (match) openFile(match.path)
  }

  function filteredFiles(): WikiFile[] {
    if (!searchQuery) return files
    const q = searchQuery.toLowerCase()
    return files.filter(f =>
      f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
    )
  }

  function filteredMentions(): string[] {
    const paths = files.map(f => f.path)
    if (!mentionFilter) return paths.slice(0, 10)
    const q = mentionFilter.toLowerCase()
    return paths.filter(p => p.toLowerCase().includes(q)).slice(0, 10)
  }

  function handleWikiChatInput(e: Event) {
    const target = e.target as HTMLInputElement
    chatInput = target.value
    const pos = target.selectionStart ?? chatInput.length
    const before = chatInput.slice(0, pos)
    const atIndex = before.lastIndexOf('@')
    if (atIndex >= 0 && (atIndex === 0 || before[atIndex - 1] === ' ')) {
      const query = before.slice(atIndex + 1)
      if (!query.includes(' ')) {
        mentionStart = atIndex
        mentionFilter = query
        showMentions = true
        selectedMention = 0
        return
      }
    }
    showMentions = false
  }

  function insertMention(path: string) {
    const before = chatInput.slice(0, mentionStart)
    const after = chatInput.slice(mentionStart + mentionFilter.length + 1)
    chatInput = `${before}@${path} ${after}`
    showMentions = false
    chatInputEl?.focus()
  }

  function submitChatInput() {
    const msg = chatInput.trim()
    if (!msg || !selected || !onChatAbout) return
    chatInput = ''
    showMentions = false
    onChatAbout(selected, msg)
  }

  function handleChatKeydown(e: KeyboardEvent) {
    if (showMentions) {
      const items = filteredMentions()
      if (e.key === 'ArrowDown') { e.preventDefault(); selectedMention = Math.min(selectedMention + 1, items.length - 1); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); selectedMention = Math.max(selectedMention - 1, 0); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (items[selectedMention]) insertMention(items[selectedMention]); return }
      if (e.key === 'Escape') { showMentions = false; return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitChatInput()
    }
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function parseTags(tagsStr: string): string[] {
    return tagsStr.replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean)
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

  $effect(() => {
    loadFiles().then(() => {
      if (initialPath) {
        // Deep-link: open the file specified in the URL
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
      {/if}
    </div>

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
        <p class="status">Select a page from the sidebar</p>
      {/if}
    </article>

    {#if selected && onChatAbout}
      <div class="wiki-chat-bar">
        {#if showMentions}
          <div class="mention-dropdown">
            {#each filteredMentions() as file, i}
              <button
                class="mention-item"
                class:selected={i === selectedMention}
                onmousedown={(e) => { e.preventDefault(); insertMention(file) }}
              >{file}</button>
            {:else}
              <div class="mention-empty">No matching files</div>
            {/each}
          </div>
        {/if}
        <input
          bind:this={chatInputEl}
          type="text"
          placeholder="Ask or edit this page..."
          bind:value={chatInput}
          oninput={handleWikiChatInput}
          onkeydown={handleChatKeydown}
        />
        <button onclick={submitChatInput} disabled={!chatInput.trim()}>→</button>
      </div>
    {/if}
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

  .viewer { flex: 1; overflow-y: auto; padding: 24px 32px; max-width: 800px; }

  .wiki-chat-bar {
    position: relative;
    display: flex;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }

  .mention-dropdown {
    position: absolute;
    bottom: 100%;
    left: 12px;
    right: 12px;
    max-height: 200px;
    overflow-y: auto;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 4px;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.3);
  }

  .mention-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--text);
    font-family: monospace;
  }

  .mention-item:hover, .mention-item.selected {
    background: var(--accent-dim);
    color: var(--accent);
  }

  .mention-empty {
    padding: 8px 12px;
    font-size: 12px;
    color: var(--text-2);
  }

  .wiki-chat-bar input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 14px;
  }

  .wiki-chat-bar input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .wiki-chat-bar button {
    padding: 8px 14px;
    border-radius: 6px;
    background: var(--accent);
    color: white;
    font-size: 14px;
    flex-shrink: 0;
  }

  .wiki-chat-bar button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
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
  .meta-tag {
    background: var(--bg-3);
    border-radius: 3px;
    padding: 1px 6px;
    font-size: 11px;
  }

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
    .sidebar { position: absolute; z-index: 10; height: 100%; }
    .viewer { padding: 16px; }
  }
</style>
