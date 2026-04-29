<script lang="ts">
  import WikiFileName from '../WikiFileName.svelte'
  import { unifiedDiffChangedLinesOnly } from '@client/lib/cards/editDiffDisplay.js'
  import '../../styles/agent-conversation/toolWriteLink.css'

  let {
    path,
    unified,
    onOpen,
  }: {
    path: string
    unified: string
    onOpen: () => void
  } = $props()

  const changedLines = $derived(unifiedDiffChangedLinesOnly(unified))
</script>

<div class="edit-diff-preview">
  <button type="button" class="tool-write-link edit-diff-open" onclick={onOpen} aria-label="Open wiki: {path}">
    <WikiFileName {path} />
  </button>
  <div class="edit-diff-lines">
    {#each changedLines as line}
      <div
        class="edit-diff-line"
        class:edit-diff-add={line.startsWith('+')}
        class:edit-diff-remove={line.startsWith('-')}
      >{line}</div>
    {/each}
  </div>
</div>

<style>
  .edit-diff-preview {
    margin: 4px 0 0;
    min-width: 0;
    max-width: 100%;
  }

  .edit-diff-open {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.35em;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    font-size: 11px;
    color: var(--text-2);
    margin-bottom: 6px;
    text-align: left;
  }

  .edit-diff-lines {
    margin: 0;
    padding: 8px 0 0;
    border-top: 1px solid var(--border);
    font-size: 11px;
    line-height: 1.45;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    max-height: 220px;
    overflow: auto;
    color: var(--text-2);
  }

  .edit-diff-line {
    white-space: pre-wrap;
    word-break: break-word;
    padding: 0 0 0 4px;
    border-left: 2px solid transparent;
  }

  .edit-diff-line.edit-diff-add {
    border-left-color: var(--success);
    color: var(--text);
  }

  .edit-diff-line.edit-diff-remove {
    border-left-color: var(--danger);
    color: var(--text);
  }
</style>
