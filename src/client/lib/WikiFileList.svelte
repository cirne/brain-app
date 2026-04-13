<script lang="ts">
  import WikiFileName from './WikiFileName.svelte'

  let {
    dirty = [],
    recent = [],
    onOpen,
    showSectionLabels = true,
    showRecent = true,
    formatDate,
  }: {
    dirty?: string[]
    recent?: { path: string; date: string }[]
    onOpen: (_path: string) => void
    showSectionLabels?: boolean
    showRecent?: boolean
    formatDate?: (_date: string) => string
  } = $props()

  function defaultFormat(date: string) {
    const d = new Date(date + 'T12:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const fmt = $derived(formatDate ?? defaultFormat)
</script>

{#if dirty.length > 0}
  {#if showSectionLabels}
    <div class="wfl-section unsaved-label">Unsaved</div>
  {/if}
  {#each dirty as path}
    <button
      class="wfl-item wfl-item--unsaved"
      onmousedown={(e) => { e.preventDefault(); onOpen(path) }}
    >
      <span class="wfl-meta dot">●</span>
      <WikiFileName {path} unsaved={true} />
    </button>
  {/each}
{/if}

{#if showRecent && recent.length > 0}
  {#if showSectionLabels && dirty.length > 0}
    <div class="wfl-section">Recent</div>
  {/if}
  {#each recent as file}
    <button
      class="wfl-item"
      onmousedown={(e) => { e.preventDefault(); onOpen(file.path) }}
    >
      <span class="wfl-meta">{fmt(file.date)}</span>
      <WikiFileName path={file.path} />
    </button>
  {/each}
{/if}

<style>
  .wfl-section {
    padding: 4px 12px 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
    border-bottom: 1px solid var(--border);
  }
  .wfl-item {
    display: grid;
    grid-template-columns: 52px 1fr;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 7px 12px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .wfl-item:last-child { border-bottom: none; }
  .wfl-item:hover { background: var(--bg-2); }
  .wfl-item:hover :global(.wfn-name) { color: var(--accent); }
  .wfl-item:hover :global(.wfn-folder) { color: var(--accent); opacity: 0.7; }


  .wfl-meta {
    font-size: 11px;
    color: var(--text-2);
    flex-shrink: 0;
  }

  .wfl-meta.dot {
    color: #e8a020;
    font-size: 8px;
    line-height: 1.8;
  }

  .wfl-item :global(.wfn-title-row) {
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
  }
</style>
