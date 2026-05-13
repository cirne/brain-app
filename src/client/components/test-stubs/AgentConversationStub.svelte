<script lang="ts">
  import type {
    AgentConversationViewProps,
    ConversationScrollApi,
  } from '@client/lib/agentConversationViewTypes.js'

  let {
    messages = [],
    streaming = false,
    tunnelWikiEnabled = false,
    tunnelWikiSelectMode = false,
  }: AgentConversationViewProps = $props()

  export const scrollToBottom: ConversationScrollApi['scrollToBottom'] = () => {}
  export const scrollToBottomIfFollowing: ConversationScrollApi['scrollToBottomIfFollowing'] = () => {}
</script>

<div
  data-testid="agent-conversation-stub"
  data-streaming={streaming ? '1' : '0'}
  data-tunnel-wiki={tunnelWikiEnabled ? '1' : '0'}
  data-tunnel-select={tunnelWikiSelectMode ? '1' : '0'}
>
  {#each messages as m, i (i)}
    <div class="stub-msg" data-role={m.role}>{m.role}: {m.content ?? ''}</div>
  {/each}
</div>
