<script lang="ts">
  type WikiFile = { path: string; name: string }

  let files = $state<WikiFile[]>([])
  let selected = $state<string | null>(null)
  let content = $state<string>('')
  let loading = $state(false)

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
  }

  $effect(() => { loadFiles() })
</script>

<div class="wiki">
  <aside class="sidebar">
    <div class="sidebar-inner">
      {#each files as f}
        <button
          class="file-item"
          class:active={selected === f.path}
          onclick={() => openFile(f.path)}
        >
          {f.name}
        </button>
      {/each}
    </div>
  </aside>

  <article class="viewer">
    {#if loading}
      <p class="status">Loading…</p>
    {:else if content}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html content}
    {:else}
      <p class="status">Select a page</p>
    {/if}
  </article>
</div>

<style>
  .wiki {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  .sidebar {
    width: var(--sidebar-w);
    border-right: 1px solid var(--border);
    flex-shrink: 0;
    overflow-y: auto;
    background: var(--bg-2);
  }

  .sidebar-inner {
    padding: 8px 0;
  }

  .file-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 16px;
    font-size: 13px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-item:hover, .file-item.active {
    color: var(--text);
    background: var(--bg-3);
  }

  .viewer {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px;
    max-width: 800px;
  }

  .status {
    color: var(--text-2);
    font-size: 14px;
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
</style>
