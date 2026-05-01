<script lang="ts">
  import { FileText } from 'lucide-svelte'
  import '../../styles/agent-conversation/toolWriteLink.css'

  let {
    title,
    sourceKind,
    excerpt,
    onOpen,
  }: {
    title: string
    sourceKind: string
    excerpt: string
    onOpen: () => void
  } = $props()
</script>

<div class="indexed-file-tool-preview">
  <button type="button" class="tool-write-link indexed-file-open" onclick={onOpen} aria-label="Open file: {title}">
    <span class="indexed-file-title-row">
      <FileText size={14} strokeWidth={2} aria-hidden="true" />
      <span class="indexed-file-title">{title}</span>
      {#if sourceKind}
        <span class="indexed-file-badge">{sourceKind}</span>
      {/if}
    </span>
  </button>
  <pre class="indexed-file-excerpt">{excerpt}</pre>
</div>

<style>
  .indexed-file-tool-preview {
    margin: 4px 0 0;
    min-width: 0;
    max-width: 100%;
  }
  .indexed-file-open {
    display: block;
    width: 100%;
    max-width: 100%;
    margin-bottom: 6px;
    font-size: 11px;
    color: var(--text-2);
    text-align: left;
  }
  .indexed-file-title-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    max-width: 100%;
  }
  .indexed-file-title {
    font-weight: 500;
    text-decoration: underline;
    text-underline-offset: 2px;
    overflow-wrap: anywhere;
  }
  .indexed-file-open:hover .indexed-file-title {
    color: var(--accent);
  }
  .indexed-file-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--chip-bg, rgba(0, 0, 0, 0.06));
    color: var(--text-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  .indexed-file-excerpt {
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
  }
</style>
