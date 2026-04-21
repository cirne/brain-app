<script lang="ts">
  import { getToolUiPolicy, type ChatMessage } from '../agentUtils.js'
  import StreamingAgentMarkdown from './StreamingAgentMarkdown.svelte'
  import ToolCallBlock from './ToolCallBlock.svelte'

  let {
    msg,
    streaming,
    isLastMessage,
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
  }: {
    msg: ChatMessage
    streaming: boolean
    isLastMessage: boolean
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
  } = $props()
</script>

<div class="message {msg.role}">
  {#if msg.role === 'user'}
    <div class="msg-label">You</div>
    <div class="msg-content user-content">{msg.content}</div>
  {:else}
    <div class="msg-label">Assistant</div>

    {#each msg.parts ?? [] as part, j (j)}
      {#if part.type === 'tool' && getToolUiPolicy(part.toolCall.name).showInChat}
        <ToolCallBlock
          toolCall={part.toolCall}
          {onOpenWiki}
          {onOpenFile}
          {onOpenEmail}
          {onOpenFullInbox}
          {onSwitchToCalendar}
          {onOpenMessageThread}
        />
      {:else if part.type === 'text' && part.content}
        <StreamingAgentMarkdown class="msg-content" content={part.content} />
      {/if}
    {/each}

    {#if streaming && isLastMessage && !msg.parts?.length}
      <div class="msg-content"><span class="cursor">|</span></div>
    {/if}
  {/if}
</div>

<style>
  .message {
    margin-bottom: 20px;
    max-width: min(800px, 100%);
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }

  .message.user {
    border-left: 2px solid var(--border);
    padding-left: 10px;
    opacity: 0.7;
  }

  .msg-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-2);
    margin-bottom: 4px;
  }

  .user-content {
    color: var(--text);
    white-space: pre-wrap;
    font-size: 14px;
    line-height: 1.5;
  }

  .cursor {
    animation: blink 1s infinite;
    color: var(--accent);
  }
  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }
</style>
