<script lang="ts">
  import WikiFileName from '../WikiFileName.svelte'

  let {
    path,
    excerpt,
    onOpen,
  }: {
    path: string
    excerpt: string
    onOpen: () => void
  } = $props()
</script>

<div class="wiki-card">
  <div class="wiki-card-path"><WikiFileName {path} /></div>
  <pre class="wiki-excerpt">{excerpt}</pre>
  <button type="button" class="open-btn" onclick={onOpen}>View full</button>
</div>

<style>
  .wiki-card {
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-3);
  }
  .wiki-card-path {
    margin-bottom: 6px;
  }
  .wiki-excerpt {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-2);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 120px;
    overflow: hidden;
  }
  .open-btn {
    margin-top: 8px;
    font-size: 12px;
    color: var(--accent);
    padding: 4px 0;
  }
  .open-btn:hover {
    text-decoration: underline;
  }
</style>
