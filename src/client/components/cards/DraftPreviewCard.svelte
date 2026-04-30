<script lang="ts">
  import { FileEdit } from 'lucide-svelte'

  let {
    draftId,
    subject,
    snippet,
    onOpen,
  }: {
    draftId: string
    subject: string
    snippet: string
    onOpen: () => void
  } = $props()
</script>

<button
  type="button"
  class="draft-tool-preview"
  onclick={onOpen}
  aria-label="Open email draft: {subject}"
>
  <span class="draft-tool-lead" aria-hidden="true">
    <FileEdit size={14} />
  </span>
  <span class="draft-tool-body">
    <span class="draft-tool-subject">{subject}</span>
    <span class="draft-tool-id">{draftId}</span>
    {#if snippet}
      <span class="draft-tool-snippet">{snippet}</span>
    {/if}
  </span>
</button>

<style>
  .draft-tool-preview {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    width: 100%;
    max-width: 100%;
    margin: 4px 0 0;
    padding: 4px 0;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }

  .draft-tool-preview:hover .draft-tool-subject {
    color: var(--accent);
  }

  .draft-tool-lead {
    flex-shrink: 0;
    color: var(--text-2);
    margin-top: 1px;
  }

  .draft-tool-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .draft-tool-subject {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .draft-tool-id {
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: var(--text-2);
  }

  .draft-tool-snippet {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-2);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
