<script lang="ts">
  import WikiFileName from '../WikiFileName.svelte'
  import { unifiedDiffChangedLinesOnly } from './editDiffDisplay.js'

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

  function onCardKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }
</script>

<div
  class="edit-diff-card"
  role="button"
  tabindex="0"
  aria-label="Open wiki: {path}"
  onclick={onOpen}
  onkeydown={onCardKeydown}
>
  <div class="edit-diff-header">
    <span class="edit-diff-label">Changes</span>
    <div class="edit-diff-path"><WikiFileName {path} /></div>
  </div>
  <div class="edit-diff-body">
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
  .edit-diff-card {
    margin: 8px 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-3);
    overflow: hidden;
    cursor: pointer;
    text-align: left;
  }
  .edit-diff-card:hover {
    background: var(--bg-2);
  }
  .edit-diff-card:focus {
    outline: none;
  }
  .edit-diff-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .edit-diff-header {
    padding: 8px 12px 6px;
    border-bottom: 1px solid var(--border);
  }
  .edit-diff-label {
    display: block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-2);
    margin-bottom: 4px;
  }
  .edit-diff-path {
    font-size: 12px;
  }
  .edit-diff-body {
    padding: 8px 12px 10px;
    font-size: 11px;
    line-height: 1.45;
    font-family: ui-monospace, monospace;
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
