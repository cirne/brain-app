<script lang="ts">
  /** Preview for `read` / `read_doc` on a filesystem path — not wiki markdown. */
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

<div class="file-card">
  <button type="button" class="file-card-hit" aria-label="Open file: {path}" onclick={onOpen}></button>
  <div class="file-card-label">File</div>
  <div class="file-path">{path}</div>
  <pre class="file-excerpt">{excerpt}</pre>
</div>

<style>
  .file-card {
    position: relative;
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-3);
  }
  .file-card-hit {
    position: absolute;
    inset: 0;
    z-index: 0;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: inherit;
    background: transparent;
    cursor: pointer;
  }
  .file-card-label {
    position: relative;
    z-index: 1;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted, #888);
    margin-bottom: 4px;
  }
  .file-path {
    position: relative;
    z-index: 1;
    font-size: 0.8rem;
    word-break: break-all;
    color: var(--text);
    margin-bottom: 8px;
  }
  .file-excerpt {
    position: relative;
    z-index: 1;
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 8rem;
    overflow: hidden;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: var(--muted, #aaa);
  }
</style>
