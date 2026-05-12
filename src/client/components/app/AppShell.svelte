<script lang="ts">
  import type { Snippet } from 'svelte'

  /**
   * Main assistant chrome:
   * - **Desktop:** full-height history rail | (top bar + workspace)
   * - **Mobile (`stackTopNavFirst`):** top bar, then history slide-over + workspace row (unchanged slide-over `top: var(--tab-h)` behavior)
   */
  let {
    stackTopNavFirst = false,
    topNav,
    sidebar,
    workspace,
  }: {
    stackTopNavFirst?: boolean
    topNav: Snippet
    sidebar: Snippet
    workspace: Snippet
  } = $props()
</script>

{#if stackTopNavFirst}
  <div class="app flex h-full min-h-0 flex-1 flex-col">
    {@render topNav()}
    <div class="app-main-row relative flex min-h-0 flex-1 flex-row">
      {@render sidebar()}
      <div class="app-workspace flex min-h-0 min-w-0 flex-1 flex-col">
        {@render workspace()}
      </div>
    </div>
  </div>
{:else}
  <div class="app flex h-full min-h-0 flex-1 flex-row">
    {@render sidebar()}
    <div class="app-main-stack flex min-h-0 min-w-0 flex-1 flex-col">
      {@render topNav()}
      <div class="app-workspace flex min-h-0 flex-1 flex-col">
        {@render workspace()}
      </div>
    </div>
  </div>
{/if}
