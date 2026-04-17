<script lang="ts">
  import { getToolIcon } from '../toolIcons.js'
  import { matchContentPreview } from '../cards/contentCards.js'
  import { getToolUiPolicy, type ToolCall } from '../agentUtils.js'
  import ContentPreviewCards from './ContentPreviewCards.svelte'
  import { formatToolArgs } from './formatToolArgs.js'
  import WikiFileName from '../WikiFileName.svelte'

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
  const displayName = $derived(policy.label ?? toolCall.name)
  const toolIcon = $derived(getToolIcon(toolCall.name))

  /** Wiki-relative path from streaming / completed tool args (write). */
  const writePathFromArgs = $derived.by((): string | null => {
    if (toolCall.name !== 'write') return null
    const a = toolCall.args
    if (a && typeof a === 'object' && typeof (a as { path?: unknown }).path === 'string') {
      const p = (a as { path: string }).path.trim()
      return p.length ? p : null
    }
    return null
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
        <span class="tool-name">{displayName}</span>
      </summary>
      {#if toolCall.args}
        <pre class="tool-args">{formatToolArgs(toolCall.args)}</pre>
      {/if}
      {#if toolCall.result && preview?.kind !== 'wiki_edit_diff' && preview?.kind !== 'message_thread'}
        <pre class="tool-result" class:tool-error={toolCall.isError} class:muted={!!preview}>{toolCall.result}</pre>
      {/if}
    </details>
    {#if preview}
      <ContentPreviewCards
        {preview}
        {onOpenWiki}
        {onOpenFile}
        {onOpenEmail}
        {onOpenFullInbox}
        {onSwitchToCalendar}
        {onOpenMessageThread}
      />
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
      {#if writePathFromArgs}
        <span class="tool-pending-file tool-pending-label">
          <span class="tool-pending-verb">Writing</span>
          <WikiFileName path={writePathFromArgs} />
          <span class="tool-pending-ellipsis" aria-hidden="true">…</span>
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

  .tool-pending-ellipsis {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    flex-shrink: 0;
    opacity: 0.85;
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
