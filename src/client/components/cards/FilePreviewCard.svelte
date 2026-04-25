<script lang="ts">
  import '../../styles/agent-conversation/toolWriteLink.css'

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

<div class="file-tool-preview">
  <button type="button" class="tool-write-link file-tool-open" onclick={onOpen} aria-label="Open file: {path}">
    <span class="file-tool-path">{path}</span>
  </button>
  <pre class="file-tool-excerpt">{excerpt}</pre>
</div>

<style>
  .file-tool-preview {
    margin: 4px 0 0;
    min-width: 0;
    max-width: 100%;
  }

  .file-tool-open {
    display: block;
    width: 100%;
    max-width: 100%;
    margin-bottom: 6px;
    font-size: 11px;
    color: var(--text-2);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .file-tool-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .file-tool-open:hover .file-tool-path {
    color: var(--accent);
  }

  .file-tool-excerpt {
    margin: 0;
    padding: 8px 0 0;
    border-top: 1px solid var(--border);
    font-size: 11px;
    line-height: 1.4;
    max-height: 8rem;
    overflow: auto;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    background: transparent;
  }
</style>
