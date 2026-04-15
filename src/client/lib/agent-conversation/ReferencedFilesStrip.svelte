<script lang="ts">
  import WikiFileName from '../WikiFileName.svelte'

  let {
    paths,
    onOpenWiki,
  }: {
    paths: string[]
    onOpenWiki?: (_path: string) => void
  } = $props()
</script>

<div class="referenced-files">
  <div class="referenced-label">Referenced</div>
  <div class="referenced-list">
    {#each paths as path}
      <button class="referenced-item" onclick={() => onOpenWiki?.(path)}>
        <WikiFileName {path} />
      </button>
    {/each}
  </div>
</div>

<style>
  .referenced-files {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .referenced-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
    margin-bottom: 6px;
  }
  .referenced-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .referenced-item {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 20px;
    font-size: 12px;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .referenced-item:hover {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
  .referenced-item:hover :global(.wfn-name) {
    color: var(--accent);
  }
  .referenced-item:hover :global(.wfn-folder) {
    color: var(--accent);
    opacity: 0.7;
  }
</style>
