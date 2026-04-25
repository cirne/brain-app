<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    subtitle,
    icon,
  }: {
    title: string
    subtitle: string
    icon: Snippet
  } = $props()
</script>

<div class="hub-source-row-body">
  <span class="hub-source-icon-wrap" aria-hidden="true">
    {@render icon()}
  </span>
  <span class="source-folder-name">{title}</span>
  <span class="source-folder-path">{subtitle}</span>
</div>

<style>
  .hub-source-row-body {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 12px;
    row-gap: 2px;
    flex: 1;
    min-width: 0;
    align-items: center;
  }

  .hub-source-icon-wrap {
    grid-column: 1;
    grid-row: 1;
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    color: var(--text-2);
  }

  .source-folder-name {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text);
    line-height: 1.25;
  }

  .source-folder-path {
    grid-column: 2;
    grid-row: 2;
    min-width: 0;
    font-size: 0.8125rem;
    color: var(--text-2);
    word-break: break-word;
    line-height: 1.35;
  }
</style>
