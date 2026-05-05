<script lang="ts">
  /**
   * Stub for BrainHubWidget in jsdom tests (avoids onMount fetch + event subscriptions).
   */
  let { onOpen }: { onOpen: () => void } = $props()
</script>

<button type="button" data-testid="brain-hub-widget-stub" onclick={onOpen}>Hub</button>
