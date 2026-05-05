<script lang="ts">
  /**
   * Renders AgentChat in mobile wiki “bridge” mode: transcript hidden behind a slide-over,
   * composer docked below — matches Assistant.svelte overlay props for doc overlays.
   */
  import AgentChat from '../AgentChat.svelte'
</script>

<AgentChat
  context={{ type: 'none' }}
  conversationHidden={true}
  mobileSlideCoversTranscriptOnly={true}
>
  {#snippet mobileDetail()}
    <div data-testid="wiki-bridge-overlay-stub">overlay</div>
  {/snippet}
</AgentChat>
