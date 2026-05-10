<script lang="ts">
  import type { ChatToolDisplayMode } from '@client/lib/chatToolDisplayPreference.js'
  import { assistantHasVisibleTextPart, getToolUiPolicy, type ChatMessage } from '@client/lib/agentUtils.js'
  import type { ContentCardPreview } from '@client/lib/cards/contentCards.js'
  import { t } from '@client/lib/i18n/index.js'
  import StreamingAgentMarkdown from './StreamingAgentMarkdown.svelte'
  import StreamingBusyDots from './StreamingBusyDots.svelte'
  import ToolCallBlock from './ToolCallBlock.svelte'
  import UserMessageContent from './UserMessageContent.svelte'

  let {
    msg,
    streaming,
    isLastMessage,
    isLastAssistantInThread: _isLastAssistantInThread,
    onOpenWiki,
    onOpenFile,
    onOpenIndexedFile,
    onOpenEmail,
    onOpenDraft,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
    onOpenMailSearchResults,
    toolDisplayMode = 'compact',
  }: {
    msg: ChatMessage
    streaming: boolean
    isLastMessage: boolean
    /** True when this row is the most recent assistant message in the session transcript. */
    isLastAssistantInThread: boolean
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenIndexedFile?: (_id: string, _source?: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
    onOpenMailSearchResults?: (
      _preview: Extract<ContentCardPreview, { kind: 'mail_search_hits' }>,
      _sourceId: string,
    ) => void
    toolDisplayMode?: ChatToolDisplayMode
  } = $props()

  /** Shown from stream start until the first `text_delta` (reasoning + tool-only turns stay visible). */
  const showPreTextThinking = $derived(
    msg.role === 'assistant' && streaming && isLastMessage && !assistantHasVisibleTextPart(msg),
  )
</script>

<div
  class={[
    'message mb-5 box-border w-full min-w-0 max-w-[min(800px,100%)]',
    msg.role,
    msg.role === 'user' && 'border-l-2 border-border pl-2.5 opacity-70',
  ]}
>
  {#if msg.role === 'user'}
    <div class="msg-label mb-1 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
      {$t('chat.messageRow.you')}
    </div>
    <UserMessageContent content={msg.content} />
  {:else}
    <div class="msg-label mb-1 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
      {$t('chat.messageRow.assistant')}
    </div>

    {#each msg.parts ?? [] as part, j (j)}
      {#if part.type === 'tool' && getToolUiPolicy(part.toolCall.name).showInChat}
        <ToolCallBlock
          toolCall={part.toolCall}
          displayMode={toolDisplayMode}
          {onOpenWiki}
          {onOpenFile}
          {onOpenIndexedFile}
          {onOpenEmail}
          {onOpenDraft}
          {onOpenFullInbox}
          {onSwitchToCalendar}
          {onOpenMessageThread}
          {onOpenMailSearchResults}
        />
      {:else if part.type === 'text' && part.content}
        <StreamingAgentMarkdown class="msg-content" content={part.content} />
      {/if}
    {/each}

    {#if showPreTextThinking}
      <div
        class="msg-content thinking-block flex min-h-[1.1em] items-center text-muted"
        role="status"
        aria-label={$t('chat.messageRow.assistantWorkingAria')}
      >
        <StreamingBusyDots />
      </div>
    {/if}
  {/if}
</div>
