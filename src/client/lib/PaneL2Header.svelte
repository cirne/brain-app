<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    left,
    center,
    right,
  }: {
    left?: Snippet
    center?: Snippet
    right?: Snippet
  } = $props()
</script>

<header class="pane-l2-header">
  <div class="pane-l2-left">
    {#if left}{@render left()}{/if}
  </div>
  <div class="pane-l2-center">
    {#if center}{@render center()}{/if}
  </div>
  <div class="pane-l2-right">
    {#if right}{@render right()}{/if}
  </div>
</header>

<style>
  .pane-l2-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 10px;
    height: var(--pane-header-h);
    min-height: var(--pane-header-h);
    max-height: var(--pane-header-h);
    padding: 0 var(--pane-header-px);
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
    box-sizing: border-box;
    overflow: hidden;
  }

  .pane-l2-left,
  .pane-l2-right {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 0;
    min-width: 0;
  }

  .pane-l2-left {
    justify-content: flex-start;
  }

  .pane-l2-right {
    justify-content: flex-end;
  }

  .pane-l2-center {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    min-width: 0;
    min-height: 0;
  }
</style>
