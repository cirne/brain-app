<script lang="ts">
  import type { ChatToolDisplayMode } from '@client/lib/chatToolDisplayPreference.js'
  import type { ConversationRoleLabels } from '@client/lib/agentConversationViewTypes.js'
  import {
    assistantHasVisibleTextPart,
    getToolUiPolicy,
    type ChatMessage,
  } from '@client/lib/agentUtils.js'
  import type { ContentCardPreview } from '@client/lib/cards/contentCards.js'
  import { chatMessagePlainText } from '@client/lib/tunnels/saveTunnelToWiki.js'
  import { t } from '@client/lib/i18n/index.js'
  import { BookmarkPlus } from 'lucide-svelte'
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
    onOpenVisualArtifact,
    toolDisplayMode = 'compact',
    conversationRoleLabels,
    tunnelWikiEnabled = false,
    tunnelWikiSelectMode = false,
    tunnelWikiSelected = false,
    onTunnelWikiSave,
    onTunnelWikiShiftClick,
    onTunnelWikiLongPress,
    onTunnelWikiCheckboxToggle,
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
    onOpenVisualArtifact?: (_ref: string, _label?: string) => void
    toolDisplayMode?: ChatToolDisplayMode
    conversationRoleLabels?: ConversationRoleLabels
    tunnelWikiEnabled?: boolean
    tunnelWikiSelectMode?: boolean
    tunnelWikiSelected?: boolean
    onTunnelWikiSave?: () => void
    onTunnelWikiShiftClick?: (_e: MouseEvent) => void
    onTunnelWikiLongPress?: () => void
    onTunnelWikiCheckboxToggle?: () => void
  } = $props()

  let longPressTimer: ReturnType<typeof setTimeout> | null = null

  const rowLabels = $derived({
    userLabel: conversationRoleLabels?.userLabel ?? $t('chat.messageRow.you'),
    assistantLabel: conversationRoleLabels?.assistantLabel ?? $t('chat.messageRow.assistant'),
    assistantWorkingAria:
      conversationRoleLabels?.assistantWorkingAria ?? $t('chat.messageRow.assistantWorkingAria'),
  })

  /** Shown from stream start until the first `text_delta` (reasoning + tool-only turns stay visible). */
  const showPreTextThinking = $derived(
    msg.role === 'assistant' && streaming && isLastMessage && !assistantHasVisibleTextPart(msg),
  )

  const showTunnelWikiBookmark = $derived(
    tunnelWikiEnabled && msg.role === 'assistant' && typeof onTunnelWikiSave === 'function',
  )

  function armLongPress() {
    if (!tunnelWikiEnabled || tunnelWikiSelectMode) return
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      onTunnelWikiLongPress?.()
    }, 550)
  }

  function disarmLongPress() {
    if (longPressTimer) clearTimeout(longPressTimer)
    longPressTimer = null
  }

  function rowClick(e: MouseEvent) {
    if (!tunnelWikiEnabled || !e.shiftKey) return
    e.preventDefault()
    onTunnelWikiShiftClick?.(e)
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={[
    'chat-message-row group relative mb-5 box-border flex w-full max-w-[min(800px,100%)] gap-2',
    tunnelWikiSelectMode && 'rounded-md ring-1 ring-border/60',
  ]}
  data-testid="chat-message-row"
  onclick={rowClick}
  onpointerdown={armLongPress}
  onpointerup={disarmLongPress}
  onpointercancel={disarmLongPress}
  onpointerleave={disarmLongPress}
>
  {#if tunnelWikiEnabled && tunnelWikiSelectMode}
    <label class="mt-1 flex shrink-0 cursor-pointer items-start pt-0.5">
      <input
        type="checkbox"
        class="mt-0.5 rounded border-border"
        checked={tunnelWikiSelected}
        onchange={() => onTunnelWikiCheckboxToggle?.()}
        onclick={(e) => e.stopPropagation()}
        data-testid="tunnel-wiki-row-checkbox"
      />
    </label>
  {/if}

  <div
    class={[
      'message min-w-0 flex-1 box-border',
      msg.role,
      msg.role === 'user' && 'border-l-2 border-border pl-2.5 opacity-70',
    ]}
  >
    {#if msg.role === 'user'}
      <div class="msg-label mb-1 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
        {rowLabels.userLabel}
      </div>
      <UserMessageContent content={msg.content} />
    {:else}
      <div class="msg-label mb-1 flex items-start justify-between gap-2 pr-7 text-[11px] font-semibold tracking-[0.05em] text-muted uppercase">
        <span>{rowLabels.assistantLabel}</span>
      </div>

      <div class="relative min-w-0">
        {#if showTunnelWikiBookmark && chatMessagePlainText(msg).length > 0}
          <div class="absolute top-0 right-0 z-[1] opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              class="inline-flex rounded-md border border-border bg-surface-2 p-1 text-muted hover:bg-surface-3 hover:text-foreground"
              title={$t('chat.saveToWiki.save')}
              aria-label={$t('chat.saveToWiki.saveOneAria')}
              data-testid="tunnel-wiki-save-message"
              onclick={(e) => {
                e.stopPropagation()
                disarmLongPress()
                onTunnelWikiSave?.()
              }}
            >
              <BookmarkPlus size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        {/if}

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
              {onOpenVisualArtifact}
            />
          {:else if part.type === 'text' && part.content}
            <StreamingAgentMarkdown class="msg-content" content={part.content} />
          {/if}
        {/each}

        {#if showPreTextThinking}
          <div
            class="msg-content thinking-block flex min-h-[1.1em] items-center text-muted"
            role="status"
            aria-label={rowLabels.assistantWorkingAria}
          >
            <StreamingBusyDots />
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
