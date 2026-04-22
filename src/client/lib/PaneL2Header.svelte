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

<header
  class="grid h-pane-header min-h-pane-header max-h-pane-header shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 overflow-hidden border-b border-border bg-surface-2 px-pane-x [box-sizing:border-box]"
>
  <div class="flex min-h-0 min-w-0 items-center justify-start gap-2">
    {#if left}{@render left()}{/if}
  </div>
  <div class="flex min-h-0 min-w-0 items-center justify-start gap-2">
    {#if center}{@render center()}{/if}
  </div>
  <div class="flex min-h-0 min-w-0 items-center justify-end gap-2">
    {#if right}{@render right()}{/if}
  </div>
</header>
