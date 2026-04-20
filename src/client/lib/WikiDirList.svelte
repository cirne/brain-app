<script lang="ts">
  import { Folder, FileText, ChevronRight } from 'lucide-svelte'
  import type { SurfaceContext } from '../router.js'
  import { listWikiDirChildren, normalizeWikiDirPath, type WikiFileRow } from './wikiDirListModel.js'

  let {
    dirPath: dirPathProp,
    refreshKey = 0,
    onOpenFile,
    onOpenDir,
    onContextChange,
  }: {
    /** Wiki-relative directory (no slashes at ends). Empty = root. */
    dirPath?: string
    refreshKey?: number
    onOpenFile: (_path: string) => void
    onOpenDir: (_path: string) => void
    onContextChange?: (_ctx: SurfaceContext) => void
  } = $props()

  const dirPath = $derived(normalizeWikiDirPath(dirPathProp))

  let files = $state<WikiFileRow[]>([])
  let loading = $state(true)
  let loadError = $state(false)

  const entries = $derived(listWikiDirChildren(files, dirPath))

  async function loadFiles() {
    loading = true
    loadError = false
    try {
      const res = await fetch('/api/wiki')
      if (!res.ok) throw new Error('bad status')
      files = (await res.json()) as WikiFileRow[]
    } catch {
      files = []
      loadError = true
    } finally {
      loading = false
    }
  }

  $effect(() => {
    void refreshKey
    void loadFiles()
  })

  $effect(() => {
    const label = dirPath ? (dirPath.split('/').pop() ?? dirPath) : 'Wiki'
    onContextChange?.({ type: 'wiki-dir', path: dirPath, title: label })
    return () => onContextChange?.({ type: 'none' })
  })
</script>

<div class="wiki-dir">
  <div class="wiki-dir-inner">
    {#if loading}
      <p class="status">Loading…</p>
    {:else if loadError}
      <p class="status status-err">Could not load wiki file list.</p>
    {:else if entries.length === 0}
      <p class="status">No pages in this folder.</p>
    {:else}
      <ul class="wiki-dir-list" aria-label={dirPath ? `Pages in ${dirPath}` : 'Wiki pages'}>
        {#each entries as entry (entry.kind + ':' + entry.path)}
          <li>
            {#if entry.kind === 'dir'}
              <button
                type="button"
                class="wiki-dir-row"
                onclick={() => onOpenDir(entry.path)}
              >
                <span class="wiki-dir-icon" aria-hidden="true"><Folder size={18} /></span>
                <span class="wiki-dir-label">{entry.label}</span>
                <span class="wiki-dir-meta">Folder</span>
                <span class="wiki-dir-chevron" aria-hidden="true"><ChevronRight size={18} /></span>
              </button>
            {:else}
              <button
                type="button"
                class="wiki-dir-row"
                onclick={() => onOpenFile(entry.path)}
              >
                <span class="wiki-dir-icon" aria-hidden="true"><FileText size={18} /></span>
                <span class="wiki-dir-label">{entry.label}</span>
                <span class="wiki-dir-meta">Page</span>
                <span class="wiki-dir-chevron" aria-hidden="true"><ChevronRight size={18} /></span>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .wiki-dir {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .wiki-dir-inner {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 24px clamp(16px, 4%, 40px);
    max-width: var(--chat-column-max);
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .status {
    margin: 0;
    font-size: 14px;
    color: var(--text-2);
  }

  .status-err {
    color: var(--text-3);
  }

  .wiki-dir-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .wiki-dir-row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 12px 14px;
    width: 100%;
    padding: 12px 0;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 0.9375rem;
    transition: padding-left 0.15s ease, color 0.12s;
  }

  .wiki-dir-row:hover {
    padding-left: 4px;
    color: var(--accent);
  }

  .wiki-dir-icon {
    display: flex;
    color: var(--text-2);
    flex-shrink: 0;
  }

  .wiki-dir-label {
    font-weight: 600;
    min-width: 0;
    word-break: break-word;
  }

  .wiki-dir-meta {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
    flex-shrink: 0;
  }

  .wiki-dir-chevron {
    flex-shrink: 0;
    color: var(--text-3);
    display: flex;
  }

  .wiki-dir-row:hover .wiki-dir-chevron {
    color: var(--accent);
  }
</style>
