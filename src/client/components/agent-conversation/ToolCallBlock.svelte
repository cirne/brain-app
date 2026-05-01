<script lang="ts">
  import '../../styles/agent-conversation/toolWriteLink.css'
  import { ChevronRight, Wrench } from 'lucide-svelte'
  import { getToolIcon } from '@client/lib/toolIcons.js'
  import { matchContentPreview, type ContentCardPreview } from '@client/lib/cards/contentCards.js'
  import { getToolUiPolicy, type ToolCall } from '@client/lib/agentUtils.js'
  import ContentPreviewCards from './ContentPreviewCards.svelte'
  import { formatToolArgs } from '@client/lib/agent-conversation/formatToolArgs.js'
  import WikiFileName from '../WikiFileName.svelte'
  import { toolDrilldownForTool } from '@client/lib/tools/toolDrilldown.js'
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
    onOpenIndexedFile,
    onOpenEmail,
    onOpenDraft,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
    onOpenMailSearchResults,
    displayMode = 'compact',
  }: {
    toolCall: ToolCall
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
    displayMode?: 'compact' | 'detailed'
  } = $props()

  const preview = $derived(matchContentPreview(toolCall))
  const policy = $derived(getToolUiPolicy(toolCall.name))
  const displayName = $derived(loadSkillToolDisplayLabel(toolCall) ?? policy.label ?? toolCall.name)
  const toolIcon = $derived(getToolIcon(toolCall.name))

  const summaryParts = $derived(toolCallCollapsedSummaryParts(toolCall, preview))
  const drilldown = $derived(toolDrilldownForTool(toolCall, preview))
  const canOpenDrilldown = $derived.by(() => {
    if (!drilldown) return false
    switch (drilldown.kind) {
      case 'wiki':
        return typeof onOpenWiki === 'function'
      case 'file':
        return typeof onOpenFile === 'function'
      case 'indexed_file':
        return typeof onOpenIndexedFile === 'function'
      case 'email':
        return typeof onOpenEmail === 'function'
      case 'email_draft':
        return typeof onOpenDraft === 'function'
      case 'calendar':
        return typeof onSwitchToCalendar === 'function'
      case 'message_thread':
        return typeof onOpenMessageThread === 'function'
      case 'inbox':
        return typeof onOpenFullInbox === 'function'
      case 'mail_search':
        return typeof onOpenMailSearchResults === 'function'
    }
  })
  const wikiLinkPath = $derived(wikiOpenPathFromArgs(toolCall.name, toolCall.args))
  const pendingVerb = $derived(wikiFilePendingVerb(toolCall.name))
  const pendingFromArgs = $derived(toolSummaryPartsFromArgs(toolCall.name, toolCall.args))

  const compactAriaLabel = $derived.by(() => {
    const prefix = `Open ${displayName}`
    if (!summaryParts) return prefix
    if (summaryParts.mode === 'single_path') return `${prefix}: ${summaryParts.path}`
    if (summaryParts.mode === 'move') return `${prefix}: ${summaryParts.from} to ${summaryParts.to}`
    return `${prefix}: ${summaryParts.text}`
  })

  function openDrilldown() {
    if (!drilldown) return
    switch (drilldown.kind) {
      case 'wiki':
        onOpenWiki?.(drilldown.path)
        break
      case 'file':
        onOpenFile?.(drilldown.path)
        break
      case 'indexed_file':
        onOpenIndexedFile?.(drilldown.id, drilldown.source)
        break
      case 'email':
        onOpenEmail?.(drilldown.id, drilldown.subject, drilldown.from)
        break
      case 'email_draft':
        onOpenDraft?.(drilldown.draftId, drilldown.subject)
        break
      case 'calendar':
        onSwitchToCalendar?.(drilldown.date, drilldown.eventId)
        break
      case 'message_thread':
        onOpenMessageThread?.(drilldown.canonicalChat, drilldown.displayLabel)
        break
      case 'inbox':
        onOpenFullInbox?.()
        break
      case 'mail_search':
        onOpenMailSearchResults?.(drilldown.preview, toolCall.id)
        break
    }
  }
</script>

{#if toolCall.done}
  <div class="tool-part">
    {#if displayMode === 'compact'}
      {#if drilldown && canOpenDrilldown}
        <button
          type="button"
          class="tool-call tool-compact tool-compact--drilldown"
          class:error={toolCall.isError}
          onclick={openDrilldown}
          aria-label={compactAriaLabel}
          title={compactAriaLabel}
        >
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
          <span class="tool-compact-truncate">
            <span class="tool-compact-truncate-inner">
              <span class="tool-name">{displayName}</span>
              {#if summaryParts}
                {#if summaryParts.mode === 'single_path'}
                  <span class="tool-summary-wiki tool-summary-wiki--compact">
                    <WikiFileName path={summaryParts.path} />
                  </span>
                {:else if summaryParts.mode === 'move'}
                  <span class="tool-summary-move tool-summary-move--compact">
                    <WikiFileName path={summaryParts.from} />
                    <span class="tool-summary-arrow" aria-hidden="true">→</span>
                    <WikiFileName path={summaryParts.to} />
                  </span>
                {:else}
                  <span class="tool-summary-plain tool-summary-plain--compact">{summaryParts.text}</span>
                {/if}
              {/if}
            </span>
          </span>
          <span class="tool-compact-pill" aria-hidden="true">
            <ChevronRight size={14} strokeWidth={2.25} aria-hidden="true" />
          </span>
        </button>
      {:else}
        <div class="tool-call tool-compact" class:error={toolCall.isError}>
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
        </div>
      {/if}
    {:else}
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
        {#if toolCall.result && preview?.kind !== 'wiki_edit_diff' && preview?.kind !== 'message_thread' && preview?.kind !== 'find_person_hits' && preview?.kind !== 'mail_search_hits' && preview?.kind !== 'feedback_draft' && preview?.kind !== 'email_draft'}
          <pre class="tool-result" class:tool-error={toolCall.isError} class:muted={!!preview}>{toolCall.result}</pre>
        {/if}
      </details>
      {#if preview}
        <div class="tool-content-preview-shell">
          <ContentPreviewCards
            {preview}
            {onOpenWiki}
            {onOpenFile}
            {onOpenIndexedFile}
            {onOpenEmail}
            {onOpenDraft}
            {onOpenFullInbox}
            {onSwitchToCalendar}
            {onOpenMessageThread}
          />
        </div>
      {/if}
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
    align-items: flex-start;
    gap: 5px;
    padding: 2px 4px;
    opacity: 0.92;
  }

  .tool-call.tool-compact {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px;
    line-height: 1.45;
    box-sizing: border-box;
  }

  .tool-call.tool-compact .tool-icon {
    margin-top: 0;
  }

  .tool-compact-truncate {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
  }

  .tool-compact-truncate-inner {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .tool-compact-truncate-inner .tool-name,
  .tool-compact-truncate-inner .tool-summary-wiki--compact,
  .tool-compact-truncate-inner .tool-summary-move--compact,
  .tool-compact-truncate-inner .tool-summary-plain--compact {
    font-size: 11px;
    color: var(--text-2);
  }

  .tool-compact-truncate-inner .tool-summary-wiki--compact,
  .tool-compact-truncate-inner .tool-summary-move--compact {
    display: inline;
  }

  .tool-compact-truncate-inner .tool-summary-plain--compact {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .tool-compact-truncate-inner > * {
    vertical-align: baseline;
  }

  .tool-compact-pill {
    flex-shrink: 0;
    align-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    padding: 4px;
    border-radius: 999px;
    color: var(--text-2);
    background: color-mix(in srgb, var(--border) 35%, transparent);
    border: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  }

  button.tool-call.tool-compact {
    width: 100%;
    font: inherit;
    color: inherit;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  button.tool-call.tool-compact--drilldown:hover .tool-compact-pill,
  button.tool-call.tool-compact--drilldown:focus-visible .tool-compact-pill {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  button.tool-call.tool-compact--drilldown:hover .tool-name,
  button.tool-call.tool-compact--drilldown:focus-visible .tool-name {
    color: var(--accent);
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
    line-height: 1.45;
  }

  .tool-summary-body {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35em 0.5em;
    min-width: 0;
    flex: 1;
  }

  .tool-summary-body .tool-name {
    flex-shrink: 0;
    line-height: inherit;
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 0.155em;
    color: var(--text-2);
  }

  /**
   * Tool strip: match title text baseline instead of vertically centering 12×12 glyphs in the summary row,
   * and align WikiFileName’s mini-icons with display name baseline (globals use center alignment).
   */
  .tool-call .tool-summary-wiki :global(.wfn-title-row),
  .tool-call .tool-summary-move :global(.wfn-title-row) {
    align-items: baseline;
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
