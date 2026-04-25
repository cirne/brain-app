<script lang="ts">
  import { assistantHasVisibleTextPart, getToolUiPolicy, type ChatMessage } from '@client/lib/agentUtils.js'
  import StreamingAgentMarkdown from './StreamingAgentMarkdown.svelte'
  import StreamingBusyDots from './StreamingBusyDots.svelte'
  import ToolCallBlock from './ToolCallBlock.svelte'

  let {
    msg,
    streaming,
    isLastMessage,
    isLastAssistantInThread,
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
    onSubmitQuickReply,
  }: {
    msg: ChatMessage
    streaming: boolean
    isLastMessage: boolean
    /** True when this row is the most recent assistant message in the session transcript. */
    isLastAssistantInThread: boolean
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
    onSubmitQuickReply?: (_text: string) => void
  } = $props()

  const choiceChipsEnabled = $derived(
    Boolean(
      onSubmitQuickReply &&
        msg.role === 'assistant' &&
        isLastAssistantInThread &&
        !streaming,
    ),
  )

  /** Shown from stream start until the first `text_delta` (reasoning + tool-only turns stay visible). */
  const showPreTextThinking = $derived(
    msg.role === 'assistant' && streaming && isLastMessage && !assistantHasVisibleTextPart(msg),
  )
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
          onChoiceSubmit={onSubmitQuickReply}
          {choiceChipsEnabled}
        />
      {:else if part.type === 'text' && part.content}
        <StreamingAgentMarkdown class="msg-content" content={part.content} />
      {/if}
    {/each}

    {#if showPreTextThinking}
      <div class="msg-content thinking-block" role="status" aria-label="Assistant is working">
        <StreamingBusyDots />
      </div>
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

  @media (max-width: 768px) {
    .user-content {
      font-size: 1rem;
    }
  }

  .thinking-block {
    display: flex;
    align-items: center;
    color: var(--text-2);
    min-height: 1.1em;
  }
</style>
