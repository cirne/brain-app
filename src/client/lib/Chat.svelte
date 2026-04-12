<script lang="ts">
  // TODO: integrate pi-web-ui's <pi-chat-panel> or <agent-interface> web component.
  // pi-web-ui Lit components can be imported and registered here:
  //   import '@mariozechner/pi-web-ui'
  // Shadow DOM is disabled so Tailwind/CSS vars work directly.
  //
  // The chat panel should connect to POST /api/chat (SSE stream).
  // @mention autocomplete: check if <message-editor> supports '@' trigger,
  // otherwise wrap with a custom input overlay.
</script>

<div class="chat">
  <p class="placeholder">Chat — pi-web-ui integration coming soon</p>
</div>

<style>
  .chat {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .placeholder {
    color: var(--text-2);
    font-size: 14px;
  }
</style>
