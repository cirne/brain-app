<script lang="ts">
  import '../../styles/agent-conversation/toolWriteLink.css'
  import { Wrench } from 'lucide-svelte'
  import { getToolIcon } from '@client/lib/toolIcons.js'
  import { matchContentPreview } from '@client/lib/cards/contentCards.js'
  import { getToolUiPolicy, type ToolCall } from '@client/lib/agentUtils.js'
  import ContentPreviewCards from './ContentPreviewCards.svelte'
  import { formatToolArgs } from '@client/lib/agent-conversation/formatToolArgs.js'
  import WikiFileName from '../WikiFileName.svelte'
  import {
    loadSkillToolDisplayLabel,
    toolCallCollapsedSummaryParts,
    toolSummaryPartsFromArgs,
    wikiFilePendingVerb,
    wikiOpenPathFromArgs,
  } from '@client/lib/tools/toolArgSummary.js'

  let {
    toolCall,
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
  }: {
    toolCall: ToolCall
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
  } = $props()

  const preview = $derived(matchContentPreview(toolCall))
  const policy = $derived(getToolUiPolicy(toolCall.name))
  const displayName = $derived(loadSkillToolDisplayLabel(toolCall) ?? policy.label ?? toolCall.name)
  const toolIcon = $derived(getToolIcon(toolCall.name))

  const summaryParts = $derived(toolCallCollapsedSummaryParts(toolCall, preview))
  const wikiLinkPath = $derived(wikiOpenPathFromArgs(toolCall.name, toolCall.args))
  const pendingVerb = $derived(wikiFilePendingVerb(toolCall.name))
  const pendingFromArgs = $derived(toolSummaryPartsFromArgs(toolCall.name, toolCall.args))
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
              <Wrench size={12} strokeWidth={2.5} />
            {/if}
          {/if}
        </span>
        <span class="tool-summary-body">
          <span class="tool-name">{displayName}</span>
          {#if summaryParts}
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
      {#if toolCall.args}
        <pre class="tool-args">{formatToolArgs(toolCall.args)}</pre>
      {/if}
      {#if toolCall.result && preview?.kind !== 'wiki_edit_diff' && preview?.kind !== 'message_thread' && preview?.kind !== 'find_person_hits' && preview?.kind !== 'mail_search_hits' && preview?.kind !== 'feedback_draft'}
        <pre class="tool-result" class:tool-error={toolCall.isError} class:muted={!!preview}>{toolCall.result}</pre>
      {/if}
    </details>
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
          <Wrench size={12} strokeWidth={2.5} />
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
    align-items: center;
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
</style>
