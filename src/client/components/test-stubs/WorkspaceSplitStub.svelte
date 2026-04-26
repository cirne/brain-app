<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    hasDetail: _hasDetail = false,
    desktopDetailOpen: _desktopDetailOpen = false,
    detailFullscreen = $bindable(false),
    onNavigateClear: _onNavigateClear = () => {},
    chat,
    desktopDetail,
  }: {
    hasDetail?: boolean
    desktopDetailOpen?: boolean
    detailFullscreen?: boolean
    onNavigateClear?: () => void
    chat?: Snippet
    desktopDetail?: Snippet
  } = $props()

  export function closeDesktopAnimated() {
    detailFullscreen = false
  }

  export function toggleDetailFullscreen() {
    detailFullscreen = !detailFullscreen
  }
</script>

<div data-testid="workspace-split-stub" class="workspace-split-stub">
  {#if chat}
    {@render chat()}
  {/if}
  {#if desktopDetail}
    {@render desktopDetail()}
  {/if}
</div>
