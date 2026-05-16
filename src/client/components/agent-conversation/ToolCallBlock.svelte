<script lang="ts">
  import '../../styles/agent-conversation/toolWriteLink.css'
  import { ChevronRight, Wrench } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import { getToolIcon } from '@client/lib/toolIcons.js'
  import { matchContentPreview, type ContentCardPreview } from '@client/lib/cards/contentCards.js'
  import { getToolUiPolicy, type ToolCall } from '@client/lib/agentUtils.js'
  import { t } from '@client/lib/i18n/index.js'
  import ContentPreviewCards from './ContentPreviewCards.svelte'
  import ToolCallSummaryStrip from './ToolCallSummaryStrip.svelte'
  import { formatToolArgs } from '@client/lib/agent-conversation/formatToolArgs.js'
  import { toolDrilldownForTool } from '@client/lib/tools/toolDrilldown.js'
  import {
    loadSkillToolDisplayLabel,
    toolCallTranscriptSummaryParts,
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
  const showCompactVisualArtifactCard = $derived(
    preview?.kind === 'visual_artifacts' && toolCall.name === 'present_visual_artifact',
  )
  const policy = $derived(getToolUiPolicy(toolCall.name))
  const skillLabel = $derived(loadSkillToolDisplayLabel(toolCall))
  const displayName = $derived(skillLabel ?? policy.label ?? toolCall.name)
  const toolIcon = $derived(getToolIcon(toolCall.name))

  const summaryParts = $derived(toolCallTranscriptSummaryParts(toolCall, preview))
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

  const labelSuffix = $derived.by(() => {
    if (toolCall.done) return ''
    if (skillLabel) return ''
    if (pendingVerb) return ''
    return '…'
  })

  const pendingLabelOverride = $derived.by(() => {
    if (toolCall.done) return null
    if (pendingVerb) return pendingVerb
    if (summaryParts?.mode === 'move') return $t('chat.toolCall.moving')
    return null
  })

  const compactAriaLabel = $derived.by(() => {
    const prefix = $t('chat.toolCall.openName', { name: displayName })
    if (!summaryParts) return prefix
    if (summaryParts.mode === 'single_path') return `${prefix}: ${summaryParts.path}`
    if (summaryParts.mode === 'move') {
      return `${prefix}: ${summaryParts.from} ${$t('chat.toolCall.to')} ${summaryParts.to}`
    }
    return `${prefix}: ${summaryParts.text}`
  })

  const rowShellClass = $derived(cn('tool-call-row', !toolCall.done && 'opacity-90'))

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

{#snippet summaryStrip(opts: { truncate?: boolean; pulse?: boolean; labelOverride?: string | null })}
  <ToolCallSummaryStrip
    displayLabel={displayName}
    {summaryParts}
    isError={!!toolCall.isError}
    truncate={opts.truncate ?? false}
    {labelSuffix}
    labelOverride={opts.labelOverride ?? pendingLabelOverride}
    pulse={opts.pulse ?? !toolCall.done}
  >
    {#snippet icon()}
      {@render toolLucideGlyph(!!toolCall.isError)}
    {/snippet}
  </ToolCallSummaryStrip>
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
            'tool-call tool-compact tool-compact--drilldown group box-border w-full cursor-pointer border-none bg-transparent p-1 text-left',
            rowShellClass,
            toolCall.isError && 'error',
          )}
          onclick={openDrilldown}
          aria-label={compactAriaLabel}
          title={compactAriaLabel}
        >
          <span class="tool-compact-truncate min-w-0 flex-1 overflow-hidden">
            {@render summaryStrip({ truncate: true, pulse: false, labelOverride: null })}
          </span>
          <span
            class="tool-compact-pill inline-flex size-6 shrink-0 items-center justify-center self-center rounded-sm border border-[color-mix(in_srgb,var(--border)_55%,transparent)] bg-[color-mix(in_srgb,var(--border)_35%,transparent)] p-0 leading-none text-muted group-hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] group-hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] group-hover:text-accent group-focus-visible:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] group-focus-visible:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] group-focus-visible:text-accent group-hover:[&_.tool-name]:text-accent"
            aria-hidden="true"
          >
            <ChevronRight size={14} strokeWidth={2.25} aria-hidden="true" />
          </span>
        </button>
      {:else}
        <div class={cn('tool-call tool-compact box-border p-1', rowShellClass, toolCall.isError && 'error')}>
          {@render summaryStrip({ pulse: false, labelOverride: null })}
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
      <details
        class={cn(
          'tool-call m-0 min-w-0 max-w-full overflow-hidden [&>summary]:cursor-pointer [&>summary]:select-none [&>summary]:p-1 [&>summary]:list-none [&>summary]:[list-style:none] [&>summary::-webkit-details-marker]:hidden',
          toolCall.isError && 'error',
        )}
        open={false}
      >
        <summary class={rowShellClass}>
          {@render summaryStrip({ pulse: false, labelOverride: null })}
        </summary>
        {#if toolCall.args}
          <pre class="tool-args m-0 max-h-[200px] max-w-full overflow-auto whitespace-pre-wrap break-words border-t border-border bg-surface p-2 px-2.5 text-[11px] leading-[1.4] text-muted [overflow-wrap:anywhere]">{formatToolArgs(toolCall.args)}</pre>
        {/if}
        {#if toolCall.result && preview?.kind !== 'wiki_edit_diff' && preview?.kind !== 'message_thread' && preview?.kind !== 'find_person_hits' && preview?.kind !== 'mail_search_hits' && preview?.kind !== 'feedback_draft' && preview?.kind !== 'email_draft'}
          <pre
            class={cn(
              'tool-result m-0 max-h-[200px] max-w-full overflow-auto whitespace-pre-wrap break-words border-t border-border bg-surface p-2 px-2.5 text-[11px] leading-[1.4] text-muted [overflow-wrap:anywhere]',
              toolCall.isError && 'tool-error text-danger',
              !!preview && 'muted max-h-20 text-[10px] opacity-65',
            )}>{toolCall.result}</pre>
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
    {#if pendingVerb && wikiLinkPath}
      <button
        type="button"
        class={cn(
          'tool-call tool-pending tool-pending-file tool-write-link box-border border-none bg-transparent p-0.5 px-1 text-left',
          rowShellClass,
        )}
        onclick={() => onOpenWiki?.(wikiLinkPath)}
        title={$t('chat.toolCall.openPath', { path: wikiLinkPath })}
      >
        {@render summaryStrip({ labelOverride: pendingVerb })}
      </button>
    {:else}
      <div class={cn('tool-call tool-pending box-border p-0.5 px-1', rowShellClass)}>
        {@render summaryStrip({})}
      </div>
    {/if}
  </div>
{/if}
