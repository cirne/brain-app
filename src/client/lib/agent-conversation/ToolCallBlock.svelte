<script lang="ts">
  import './toolWriteLink.css'
  import { getToolIcon } from '../toolIcons.js'
  import { matchContentPreview } from '../cards/contentCards.js'
  import { getToolUiPolicy, type ToolCall } from '../agentUtils.js'
  import ContentPreviewCards from './ContentPreviewCards.svelte'
  import { formatToolArgs } from './formatToolArgs.js'
  import WikiFileName from '../WikiFileName.svelte'
  import {
    toolCallCollapsedSummaryParts,
    toolSummaryPartsFromArgs,
    wikiFilePendingVerb,
    wikiOpenPathFromArgs,
  } from '../tools/toolArgSummary.js'
  import { extractSuggestReplyChoices } from '../tools/suggestReplyChoices.js'

  let {
    toolCall,
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
    onChoiceSubmit,
    choiceChipsEnabled = false,
  }: {
    toolCall: ToolCall
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
    onChoiceSubmit?: (_text: string) => void
    /** When true, quick-reply chips from **suggest_reply_options** are tappable. */
    choiceChipsEnabled?: boolean
  } = $props()

  let quickReplyPickedIndex = $state<number | null>(null)

  const preview = $derived(matchContentPreview(toolCall))
  const policy = $derived(getToolUiPolicy(toolCall.name))
  const displayName = $derived(policy.label ?? toolCall.name)
  const toolIcon = $derived(getToolIcon(toolCall.name))

  const summaryParts = $derived(toolCallCollapsedSummaryParts(toolCall, preview))
  const wikiLinkPath = $derived(wikiOpenPathFromArgs(toolCall.name, toolCall.args))
  const pendingVerb = $derived(wikiFilePendingVerb(toolCall.name))
  const pendingFromArgs = $derived(toolSummaryPartsFromArgs(toolCall.name, toolCall.args))

  const quickReplyChoices = $derived(
    !toolCall.isError && toolCall.name === 'suggest_reply_options' ? extractSuggestReplyChoices(toolCall) : null,
  )
  const showQuickReplyChips = $derived(quickReplyChoices != null && quickReplyChoices.length > 0)
  const canTapQuickReplies = $derived(
    Boolean(showQuickReplyChips && choiceChipsEnabled && onChoiceSubmit && quickReplyPickedIndex === null),
  )

  function pickQuickReply(submit: string, index: number) {
    if (!onChoiceSubmit || !canTapQuickReplies) return
    quickReplyPickedIndex = index
    onChoiceSubmit(submit)
  }

  $effect(() => {
    void toolCall.id
    quickReplyPickedIndex = null
  })
</script>

{#if toolCall.done}
  <div class="tool-part">
    <details class="tool-call" class:error={toolCall.isError} open={false}>
      <summary>
        <span class="tool-icon">
          {#if toolCall.isError}
            !
          {:else}
            {#if toolIcon}
              {@const Icon = toolIcon}
              <Icon size={12} strokeWidth={2.5} />
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            {/if}
          {/if}
        </span>
        <span class="tool-summary-body">
          <span class="tool-name">{displayName}</span>
          {#if showQuickReplyChips && quickReplyChoices}
            <span class="tool-summary-plain">({quickReplyChoices.length} options)</span>
          {:else if summaryParts}
            {#if summaryParts.mode === 'single_path'}
              <span class="tool-summary-wiki">
                <WikiFileName path={summaryParts.path} />
              </span>
            {:else if summaryParts.mode === 'move'}
              <span class="tool-summary-move">
                <WikiFileName path={summaryParts.from} />
                <span class="tool-summary-arrow" aria-hidden="true">→</span>
                <WikiFileName path={summaryParts.to} />
              </span>
            {:else}
              <span class="tool-summary-plain" title={summaryParts.text}>{summaryParts.text}</span>
            {/if}
          {/if}
        </span>
      </summary>
      {#if toolCall.args && !showQuickReplyChips}
        <pre class="tool-args">{formatToolArgs(toolCall.args)}</pre>
      {/if}
      {#if toolCall.result && !showQuickReplyChips && preview?.kind !== 'wiki_edit_diff' && preview?.kind !== 'message_thread' && preview?.kind !== 'find_person_hits' && preview?.kind !== 'mail_search_hits' && preview?.kind !== 'feedback_draft'}
        <pre class="tool-result" class:tool-error={toolCall.isError} class:muted={!!preview}>{toolCall.result}</pre>
      {/if}
    </details>
    {#if showQuickReplyChips && quickReplyChoices}
      <div
        class="quick-reply-chips"
        role="group"
        aria-label="Quick replies"
      >
        {#each quickReplyChoices as c, ridx (c.id ?? `${ridx}-${c.label}`)}
          <button
            type="button"
            class="quick-reply-chip"
            disabled={!canTapQuickReplies}
            onclick={() => pickQuickReply(c.submit, ridx)}
          >{c.label}</button>
        {/each}
      </div>
    {/if}
    {#if preview}
      <div class="tool-content-preview-shell">
        <ContentPreviewCards
          {preview}
          {onOpenWiki}
          {onOpenFile}
          {onOpenEmail}
          {onOpenFullInbox}
          {onSwitchToCalendar}
          {onOpenMessageThread}
        />
      </div>
    {/if}
  </div>
{:else}
  <div class="tool-part" role="status">
    <div class="tool-call tool-pending">
      <span class="tool-icon">
        {#if toolIcon}
          {@const Icon = toolIcon}
          <Icon size={12} strokeWidth={2.5} />
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
        {/if}
      </span>
      {#if pendingFromArgs?.mode === 'move'}
        <div class="tool-pending-move tool-pending-label">
          <span class="tool-pending-verb">Moving</span>
          <span class="tool-summary-move tool-summary-move--pending">
            <WikiFileName path={pendingFromArgs.from} />
            <span class="tool-summary-arrow" aria-hidden="true">→</span>
            <WikiFileName path={pendingFromArgs.to} />
          </span>
        </div>
      {:else if pendingVerb && wikiLinkPath}
        <button
          class="tool-pending-file tool-pending-label tool-write-link"
          onclick={() => onOpenWiki?.(wikiLinkPath)}
          title="Open {wikiLinkPath}"
        >
          <span class="tool-pending-verb">{pendingVerb}</span>
          <WikiFileName path={wikiLinkPath} />
        </button>
      {:else if pendingFromArgs?.mode === 'text'}
        <span class="tool-pending-split tool-pending-label">
          <span class="tool-name">{displayName}…</span>
          <span class="tool-pending-plain" title={pendingFromArgs.text}>{pendingFromArgs.text}</span>
        </span>
      {:else}
        <span class="tool-name tool-pending-label">{displayName}…</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .tool-part {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 4px 0 12px;
    min-width: 0;
    max-width: 100%;
  }

  /** Rich previews (inbox, calendar, mail hits, file read, etc.): primary surface so they read as “cards” on --bg-2 chat pane. */
  .tool-content-preview-shell {
    background: var(--bg);
    border: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
    border-radius: 6px;
    padding: 10px 12px;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }

  .tool-call {
    margin: 0;
    border-radius: 4px;
    font-size: 13px;
    overflow: hidden;
    min-width: 0;
    max-width: 100%;
  }

  .tool-call.tool-pending {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 4px;
    opacity: 0.92;
  }

  .tool-pending-label {
    animation: tool-pending-pulse 1.2s ease-in-out infinite;
  }

  .tool-pending-file {
    display: inline-flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.35em;
    min-width: 0;
    font-size: 11px;
    color: var(--text-2);
  }

  .tool-pending-verb {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    flex-shrink: 0;
  }

  @keyframes tool-pending-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }

  .tool-call summary {
    display: flex;
    align-items: flex-start;
    gap: 5px;
    padding: 2px 4px;
    cursor: pointer;
    user-select: none;
    list-style: none;
  }

  .tool-summary-body {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35em 0.5em;
    min-width: 0;
  }

  .tool-summary-body .tool-name {
    flex-shrink: 0;
  }

  .tool-summary-wiki,
  .tool-summary-move {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25em;
    min-width: 0;
    font-size: 11px;
    color: var(--text-2);
  }

  .tool-summary-move--pending {
    flex: 1;
    min-width: 0;
  }

  .tool-summary-arrow {
    flex-shrink: 0;
    opacity: 0.55;
    font-size: 10px;
  }

  .tool-summary-plain {
    font-size: 11px;
    color: var(--text-2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: min(100%, 28rem);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .tool-pending-move {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35em;
    min-width: 0;
    flex: 1;
  }

  .tool-pending-split {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35em 0.5em;
    min-width: 0;
    flex: 1;
  }

  .tool-pending-plain {
    font-size: 11px;
    color: var(--text-2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: min(100%, 28rem);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  .tool-call summary::-webkit-details-marker {
    display: none;
  }

  .tool-icon {
    width: 12px;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-2);
  }

  .tool-call.error .tool-icon {
    color: var(--danger);
  }

  .tool-name {
    font-family: monospace;
    font-size: 11px;
    color: var(--text-2);
  }

  .tool-args,
  .tool-result {
    margin: 0;
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.4;
    max-height: 200px;
    max-width: 100%;
    box-sizing: border-box;
    overflow: auto;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    word-break: break-word;
    border-top: 1px solid var(--border);
    color: var(--text-2);
    background: var(--bg);
  }

  .tool-error {
    color: var(--danger);
  }

  .tool-result.muted {
    max-height: 80px;
    opacity: 0.65;
    font-size: 10px;
  }

  .quick-reply-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 8px;
    align-items: center;
    margin: 0 0 4px;
    min-width: 0;
  }

  .quick-reply-chip {
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--border) 80%, var(--text-2) 5%);
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    line-height: 1.3;
    padding: 0.4em 0.9em;
    max-width: 100%;
    cursor: pointer;
    text-align: center;
  }

  .quick-reply-chip:hover:not(:disabled) {
    background: color-mix(in srgb, var(--bg) 90%, var(--text-2) 8%);
  }

  .quick-reply-chip:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
