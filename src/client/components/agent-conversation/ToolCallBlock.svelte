<script lang="ts">
  import '../../styles/agent-conversation/toolWriteLink.css'
  import { ChevronRight, Wrench } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import { getToolIcon } from '@client/lib/toolIcons.js'
  import { matchContentPreview, type ContentCardPreview } from '@client/lib/cards/contentCards.js'
  import { getToolUiPolicy, type ToolCall } from '@client/lib/agentUtils.js'
  import { t } from '@client/lib/i18n/index.js'
  import ContentPreviewCards from './ContentPreviewCards.svelte'
  import ChatInlineIndicator from './ChatInlineIndicator.svelte'
  import { formatToolArgs } from '@client/lib/agent-conversation/formatToolArgs.js'
  import WikiFileName from '@components/WikiFileName.svelte'
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
    onOpenVisualArtifact,
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
    onOpenVisualArtifact?: (_ref: string, _label?: string) => void
    displayMode?: 'compact' | 'detailed' | 'focused'
  } = $props()

  const preview = $derived(matchContentPreview(toolCall))
  /** Compact rows stay minimal; inline image/PDF cards only for the dedicated present tool (not read_mail / read_attachment). */
  const showCompactVisualArtifactCard = $derived(
    preview?.kind === 'visual_artifacts' && toolCall.name === 'present_visual_artifact',
  )
  const policy = $derived(getToolUiPolicy(toolCall.name))
  const displayName = $derived(loadSkillToolDisplayLabel(toolCall) ?? policy.label ?? toolCall.name)
  const toolIcon = $derived(getToolIcon(toolCall.name))

  const summaryParts = $derived(toolCallCollapsedSummaryParts(toolCall, preview))
  const drilldown = $derived(toolDrilldownForTool(toolCall, preview))
  const canOpenDrilldown = $derived.by(() => {
    if (!drilldown) return false
    switch (drilldown.kind) {
      case 'wiki': return typeof onOpenWiki === 'function'
      case 'file': return typeof onOpenFile === 'function'
      case 'indexed_file': return typeof onOpenIndexedFile === 'function'
      case 'email': return typeof onOpenEmail === 'function'
      case 'email_draft': return typeof onOpenDraft === 'function'
      case 'calendar': return typeof onSwitchToCalendar === 'function'
      case 'message_thread': return typeof onOpenMessageThread === 'function'
      case 'inbox': return typeof onOpenFullInbox === 'function'
      case 'mail_search': return typeof onOpenMailSearchResults === 'function'
    }
  })
  const wikiLinkPath = $derived(wikiOpenPathFromArgs(toolCall.name, toolCall.args))
  const pendingVerb = $derived(wikiFilePendingVerb(toolCall.name))
  const pendingFromArgs = $derived(toolSummaryPartsFromArgs(toolCall.name, toolCall.args))

  const compactAriaLabel = $derived.by(() => {
    const prefix = $t('chat.toolCall.openName', { name: displayName })
    if (!summaryParts) return prefix
    if (summaryParts.mode === 'single_path') return `${prefix}: ${summaryParts.path}`
    if (summaryParts.mode === 'move') {
      return `${prefix}: ${summaryParts.from} ${$t('chat.toolCall.to')} ${summaryParts.to}`
    }
    return `${prefix}: ${summaryParts.text}`
  })

  function openDrilldown() {
    if (!drilldown) return
    switch (drilldown.kind) {
      case 'wiki': onOpenWiki?.(drilldown.path); break
      case 'file': onOpenFile?.(drilldown.path); break
      case 'indexed_file': onOpenIndexedFile?.(drilldown.id, drilldown.source); break
      case 'email': onOpenEmail?.(drilldown.id, drilldown.subject, drilldown.from); break
      case 'email_draft': onOpenDraft?.(drilldown.draftId, drilldown.subject); break
      case 'calendar': onSwitchToCalendar?.(drilldown.date, drilldown.eventId); break
      case 'message_thread': onOpenMessageThread?.(drilldown.canonicalChat, drilldown.displayLabel); break
      case 'inbox': onOpenFullInbox?.(); break
      case 'mail_search': onOpenMailSearchResults?.(drilldown.preview, toolCall.id); break
    }
  }
</script>

{#snippet toolLucideGlyph(isError: boolean)}
  {#if isError}
    !
  {:else if toolIcon}
    {@const Icon = toolIcon}
    <Icon size={12} strokeWidth={2.5} />
  {:else}
    <Wrench size={12} strokeWidth={2.5} />
  {/if}
{/snippet}

{#snippet summaryCompactStrip(isCompactTruncate: boolean)}
  <span
    class={cn(
      isCompactTruncate
        ? 'tool-compact-truncate-inner flex min-w-0 flex-1 items-center gap-x-2 overflow-hidden'
        : 'tool-summary-body flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-[0.35em]',
    )}
  >
    <ChatInlineIndicator
      variant={toolCall.isError ? 'error' : 'default'}
      inlineMetrics={isCompactTruncate ? 'inherit' : 'default'}
      class="shrink-0"
    >
      {#snippet icon()}
        {@render toolLucideGlyph(!!toolCall.isError)}
      {/snippet}
      {#snippet children()}
        <span class="tool-name shrink-0 font-mono text-muted">{displayName}</span>
      {/snippet}
    </ChatInlineIndicator>
    {#if summaryParts}
      {#if summaryParts.mode === 'single_path'}
        <ChatInlineIndicator
          labelOnly
          inlineMetrics={isCompactTruncate ? 'inherit' : 'default'}
          class="min-w-0 shrink"
        >
          {#snippet children()}
            <WikiFileName path={summaryParts.path} stripAlign={isCompactTruncate} />
          {/snippet}
        </ChatInlineIndicator>
      {:else if summaryParts.mode === 'move'}
        <span
          class={cn(
            'tool-summary-move inline-flex min-w-0 flex-1 flex-wrap items-center gap-1 text-muted',
            isCompactTruncate ? 'overflow-hidden' : 'min-h-6 text-[11px] [&_.wfn-title-row]:items-center',
          )}
        >
          <WikiFileName path={summaryParts.from} stripAlign={isCompactTruncate} />
          <span class="tool-summary-arrow shrink-0 text-[10px] opacity-55" aria-hidden="true">→</span>
          <WikiFileName path={summaryParts.to} stripAlign={isCompactTruncate} />
        </span>
      {:else}
        <span
          class={cn(
            'tool-summary-plain min-w-0 max-w-[min(100%,28rem)] truncate font-mono text-muted',
            isCompactTruncate ? 'tool-summary-plain--compact' : 'min-h-6 text-[11px]',
          )}
          title={isCompactTruncate ? undefined : summaryParts.text}>{summaryParts.text}</span>
      {/if}
    {/if}
  </span>
{/snippet}

{#snippet summaryDetailedBody()}
  <span class="tool-summary-body inline-flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-[0.35em]">
    <span class="tool-name shrink-0 font-mono text-[11px] text-muted leading-[inherit]">{displayName}</span>
    {#if summaryParts}
      {#if summaryParts.mode === 'single_path'}
        <span
          class="tool-summary-wiki inline-flex min-w-0 flex-wrap items-baseline gap-1 text-[11px] text-muted [&_.wfn-title-row]:items-baseline"
        >
          <WikiFileName path={summaryParts.path} />
        </span>
      {:else if summaryParts.mode === 'move'}
        <span
          class="tool-summary-move inline-flex min-w-0 flex-wrap items-baseline gap-1 text-[11px] text-muted [&_.wfn-title-row]:items-baseline"
        >
          <WikiFileName path={summaryParts.from} />
          <span class="tool-summary-arrow shrink-0 text-[10px] opacity-55" aria-hidden="true">→</span>
          <WikiFileName path={summaryParts.to} />
        </span>
      {:else}
        <span
          class="tool-summary-plain min-w-0 max-w-[min(100%,28rem)] truncate font-mono text-[11px] text-muted"
          title={summaryParts.text}>{summaryParts.text}</span>
      {/if}
    {/if}
  </span>
{/snippet}

{#if toolCall.done}
  <div
    class="tool-part m-0 mt-1 mb-3 flex min-w-0 max-w-full flex-col gap-2.5"
    data-tool-name={toolCall.name}
    data-tool-done="true"
    data-tool-error={toolCall.isError ? 'true' : 'false'}
  >
    {#if displayMode === 'compact' || displayMode === 'focused'}
      {#if drilldown && canOpenDrilldown}
        <button
          type="button"
          class={cn(
            'tool-call tool-compact tool-compact--drilldown group m-0 box-border flex w-full min-w-0 max-w-full cursor-pointer items-center gap-1.5 overflow-hidden border-none bg-transparent p-1 text-left text-[13px] leading-[1.45] font-[inherit] text-[inherit]',
            toolCall.isError && 'error',
          )}
          onclick={openDrilldown}
          aria-label={compactAriaLabel}
          title={compactAriaLabel}
        >
          <span class="tool-compact-truncate min-w-0 flex-1 overflow-hidden">
            {@render summaryCompactStrip(true)}
          </span>
          <span
            class="tool-compact-pill inline-flex size-6 shrink-0 items-center justify-center self-center rounded-sm border border-[color-mix(in_srgb,var(--border)_55%,transparent)] bg-[color-mix(in_srgb,var(--border)_35%,transparent)] p-0 leading-none text-muted group-hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] group-hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] group-hover:text-accent group-focus-visible:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] group-focus-visible:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] group-focus-visible:text-accent group-hover:[&_.tool-name]:text-accent"
            aria-hidden="true"
          >
            <ChevronRight size={14} strokeWidth={2.25} aria-hidden="true" />
          </span>
        </button>
      {:else}
        <div class={cn('tool-call tool-compact m-0 box-border flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden p-1 text-[13px] leading-[1.45]', toolCall.isError && 'error')}>
          {@render summaryCompactStrip(false)}
        </div>
      {/if}
      {#if showCompactVisualArtifactCard}
        <div class="tool-content-preview-shell box-border min-w-0 max-w-full border border-[color-mix(in_srgb,var(--border)_55%,transparent)] bg-surface px-3 py-2.5">
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
            {onOpenVisualArtifact}
          />
        </div>
      {/if}
    {:else}
      <details class={cn('tool-call m-0 min-w-0 max-w-full overflow-hidden text-[13px] [&>summary]:flex [&>summary]:cursor-pointer [&>summary]:select-none [&>summary]:items-start [&>summary]:gap-1.5 [&>summary]:p-1 [&>summary]:leading-[1.45] [&>summary]:list-none [&>summary]:[list-style:none] [&>summary::-webkit-details-marker]:hidden', toolCall.isError && 'error')} open={false}>
        <summary>
          <span
            class={cn(
              'tool-transcript-icon inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center text-muted [&>svg]:block',
              toolCall.isError && 'text-danger',
            )}
            aria-hidden="true"
          >
            {@render toolLucideGlyph(!!toolCall.isError)}
          </span>
          {@render summaryDetailedBody()}
        </summary>
        {#if toolCall.args}
          <pre class="tool-args m-0 max-h-[200px] max-w-full overflow-auto whitespace-pre-wrap break-words border-t border-border bg-surface p-2 px-2.5 text-[11px] leading-[1.4] text-muted [overflow-wrap:anywhere]">{formatToolArgs(toolCall.args)}</pre>
        {/if}
        {#if toolCall.result && preview?.kind !== 'wiki_edit_diff' && preview?.kind !== 'message_thread' && preview?.kind !== 'find_person_hits' && preview?.kind !== 'mail_search_hits' && preview?.kind !== 'feedback_draft' && preview?.kind !== 'email_draft'}
          <pre class={cn('tool-result m-0 max-h-[200px] max-w-full overflow-auto whitespace-pre-wrap break-words border-t border-border bg-surface p-2 px-2.5 text-[11px] leading-[1.4] text-muted [overflow-wrap:anywhere]', toolCall.isError && 'tool-error text-danger', !!preview && 'muted max-h-20 text-[10px] opacity-65')}>{toolCall.result}</pre>
        {/if}
      </details>
      {#if preview}
        <div class="tool-content-preview-shell box-border min-w-0 max-w-full border border-[color-mix(in_srgb,var(--border)_55%,transparent)] bg-surface px-3 py-2.5">
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
            {onOpenVisualArtifact}
          />
        </div>
      {/if}
    {/if}
  </div>
{:else}
  <div
    class="tool-part m-0 mt-1 mb-3 flex min-w-0 max-w-full flex-col gap-2.5"
    role="status"
    data-tool-name={toolCall.name}
    data-tool-done="false"
    data-tool-error={toolCall.isError ? 'true' : 'false'}
  >
    <div class="tool-call tool-pending m-0 flex items-center gap-1.5 overflow-hidden p-0.5 px-1 text-[13px] opacity-90">
      {#if pendingFromArgs?.mode === 'move'}
        <ChatInlineIndicator>
          {#snippet icon()}
            {@render toolLucideGlyph(false)}
          {/snippet}
          {#snippet children()}
            <span class="tool-pending-verb shrink-0 font-mono">{$t('chat.toolCall.moving')}</span>
          {/snippet}
        </ChatInlineIndicator>
        <span class="tool-pending-move tool-pending-label flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-[0.35em] [animation:tool-pending-pulse_1.2s_ease-in-out_infinite]">
          <span class="tool-summary-move tool-summary-move--pending inline-flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[11px] text-muted [&_.wfn-title-row]:items-center">
            <WikiFileName path={pendingFromArgs.from} stripAlign />
            <span class="tool-summary-arrow shrink-0 text-[10px] opacity-55" aria-hidden="true">→</span>
            <WikiFileName path={pendingFromArgs.to} stripAlign />
          </span>
        </span>
      {:else if pendingVerb && wikiLinkPath}
        <button
          type="button"
          class="tool-pending-file tool-pending-label tool-write-link inline-flex min-w-0 items-center gap-x-2 text-[11px] text-muted [animation:tool-pending-pulse_1.2s_ease-in-out_infinite]"
          onclick={() => onOpenWiki?.(wikiLinkPath)}
          title={$t('chat.toolCall.openPath', { path: wikiLinkPath })}
        >
          <ChatInlineIndicator>
            {#snippet icon()}
              {@render toolLucideGlyph(false)}
            {/snippet}
            {#snippet children()}
              <span class="tool-pending-verb shrink-0 font-mono">{pendingVerb}</span>
            {/snippet}
          </ChatInlineIndicator>
          <ChatInlineIndicator labelOnly class="min-w-0 shrink">
            {#snippet children()}
              <WikiFileName path={wikiLinkPath} stripAlign />
            {/snippet}
          </ChatInlineIndicator>
        </button>
      {:else if pendingFromArgs?.mode === 'text'}
        <span class="tool-pending-split tool-pending-label inline-flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-[0.35em] [animation:tool-pending-pulse_1.2s_ease-in-out_infinite]">
          <ChatInlineIndicator class="shrink-0">
            {#snippet icon()}
              {@render toolLucideGlyph(false)}
            {/snippet}
            {#snippet children()}
              <span class="tool-name font-mono text-muted">{displayName}…</span>
            {/snippet}
          </ChatInlineIndicator>
          <span class="tool-pending-plain min-h-6 min-w-0 max-w-[min(100%,28rem)] truncate font-mono text-[11px] text-muted" title={pendingFromArgs.text}>{pendingFromArgs.text}</span>
        </span>
      {:else}
        <ChatInlineIndicator>
          {#snippet icon()}
            {@render toolLucideGlyph(false)}
          {/snippet}
          {#snippet children()}
            <span class="tool-name tool-pending-label font-mono text-muted [animation:tool-pending-pulse_1.2s_ease-in-out_infinite]">{displayName}…</span>
          {/snippet}
        </ChatInlineIndicator>
      {/if}
    </div>
  </div>
{/if}

<style>
  @keyframes tool-pending-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.55; }
  }
</style>
