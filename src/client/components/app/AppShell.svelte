<script lang="ts">
  import type { Snippet } from 'svelte'

  /** Main assistant chrome: top bar + primary row (history rail + workspace). */
  let {
    topNav,
    sidebar,
    workspace,
  }: {
    topNav: Snippet
    sidebar: Snippet
    workspace: Snippet
  } = $props()
</script>

<div class="app flex h-full flex-col">
  {@render topNav()}
  <div class="app-main-row relative flex min-h-0 flex-1">
    {@render sidebar()}
    {@render workspace()}
  </div>
</div>
