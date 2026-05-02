<script lang="ts">
  /**
   * Stub for BrainHubWidget in jsdom tests (avoids onMount fetch + event subscriptions).
   */
  type Props = {
    onOpen: () => void
    shareInviteBadge?: boolean
  }
  let { onOpen, shareInviteBadge = false }: Props = $props()
</script>

<button
  type="button"
  data-testid="brain-hub-widget-stub"
  data-share-invite-badge={shareInviteBadge ? '1' : '0'}
  onclick={onOpen}
  title="Braintunnel Hub"
>
  Hub
</button>
