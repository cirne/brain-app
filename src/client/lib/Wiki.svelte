<script lang="ts">
  import { mount, unmount } from 'svelte'
  import WikiFileName from './WikiFileName.svelte'
  import { normalizeWikiPathForMatch, transformWikiPageHtml } from './wikiPageHtml.js'
  import { renderMarkdown } from './markdown.js'

  type WikiFile = { path: string; name: string }

  import type { SurfaceContext } from '../router.js'

  let {
    initialPath,
    refreshKey = 0,
    streamingWrite = null as { path: string; body: string } | null,
    onNavigate,
    onContextChange,
  }: {
    initialPath?: string
    refreshKey?: number
    /** Live markdown while agent streams `write` for this path (file may not exist yet). */
    streamingWrite?: { path: string; body: string } | null
    onNavigate?: (_path: string | undefined) => void
    onContextChange?: (_ctx: SurfaceContext) => void
  } = $props()

  let files = $state<WikiFile[]>([])
  let selected = $state<string | null>(null)
  let content = $state<string>('')
  let meta = $state<Record<string, string>>({})
  let loading = $state(false)



  async function loadFiles() {
    const res = await fetch('/api/wiki')
    files = await res.json()
  }

  async function openFile(path: string) {
    selected = path
    onNavigate?.(path)
    loading = true
    try {
      const res = await fetch(`/api/wiki/${encodeURIComponent(path)}`)
      if (!res.ok) {
        meta = {}
        content = ''
        loading = false
        const title = path.replace(/\.md$/, '').split('/').pop() ?? path
        onContextChange?.({ type: 'wiki', path, title })
        return
      }
      const data = await res.json()
      meta = data.meta ?? {}
      content = transformWikiPageHtml(data.html)
      loading = false
      const title = meta.title ?? path.replace(/\.md$/, '').split('/').pop() ?? path
      onContextChange?.({ type: 'wiki', path, title })
    } catch {
      meta = {}
      content = ''
      loading = false
      const title = path.replace(/\.md$/, '').split('/').pop() ?? path
      onContextChange?.({ type: 'wiki', path, title })
    }
  }

  function handleContentClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a[data-wiki]')
    if (!a) return
    e.preventDefault()
    const link = a.getAttribute('data-wiki')!
    const normalized = normalizeWikiPathForMatch(link)
    const match = files.find(f => normalizeWikiPathForMatch(f.path) === normalized)
    if (match) openFile(match.path)
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
  <div class="content-area">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <article class="viewer" onclick={handleContentClick} use:upgradeWikiLinks={content}>
      {#if loading}
        <p class="status">Loading...</p>
      {:else if streamingWrite && streamingWrite.path === selected && streamingWrite.body}
        <p class="stream-label" role="status">Agent is writing…</p>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="stream-md markdown">{@html renderMarkdown(streamingWrite.body.slice(0, 50000))}</div>
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
        <p class="status">No page selected</p>
      {/if}
    </article>
  </div>
</div>

<style>
  .wiki { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

  /* ── content ─────────────────────────────────────────────── */
  .content-area { flex: 1; overflow-y: auto; min-width: 0; }

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
