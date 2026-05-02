<script lang="ts">
  /**
   * Stub for BrainHubWidget in jsdom tests (avoids onMount fetch + event subscriptions).
   */
  type Props = {
    onOpen: () => void
  }
  let { onOpen }: Props = $props()
</script>

<button
  type="button"
  data-testid="brain-hub-widget-stub"
  onclick={onOpen}
  title="Braintunnel Hub"
>
  Hub
</button>
