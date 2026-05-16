<script lang="ts">
  import { cn } from '@client/lib/cn.js'
  import type { ToolSummaryParts } from '@client/lib/tools/toolArgSummary.js'
  import ChatInlineIndicator from './ChatInlineIndicator.svelte'
  import WikiFileName from '@components/WikiFileName.svelte'

  let {
    displayLabel,
    summaryParts = null,
    icon,
    isError = false,
    truncate = false,
    labelSuffix = '',
    labelOverride = null,
    pulse = false,
  }: {
    displayLabel: string
    summaryParts?: ToolSummaryParts | null
    icon: import('svelte').Snippet
    isError?: boolean
    truncate?: boolean
    labelSuffix?: string
    labelOverride?: string | null
    pulse?: boolean
  } = $props()

  const primaryLabel = $derived(`${labelOverride ?? displayLabel}${labelSuffix}`)
</script>

<div
  class={cn(
    'tool-summary-body',
    truncate && 'tool-summary-body--truncate',
    pulse && 'tool-pending-label',
  )}
>
  <ChatInlineIndicator variant={isError ? 'error' : 'default'} class="shrink-0" {icon}>
    {#snippet children()}
      <span class="tool-name shrink-0">{primaryLabel}</span>
    {/snippet}
  </ChatInlineIndicator>
  {#if summaryParts}
    {#if summaryParts.mode === 'single_path'}
      <ChatInlineIndicator labelOnly class="min-w-0 shrink">
        {#snippet children()}
          <WikiFileName path={summaryParts.path} />
        {/snippet}
      </ChatInlineIndicator>
    {:else if summaryParts.mode === 'move'}
      <ChatInlineIndicator labelOnly class="min-w-0 shrink overflow-hidden">
        {#snippet children()}
          <span class="tool-summary-move">
            <WikiFileName path={summaryParts.from} />
            <span class="shrink-0 text-[10px] opacity-55" aria-hidden="true">→</span>
            <WikiFileName path={summaryParts.to} />
          </span>
        {/snippet}
      </ChatInlineIndicator>
    {:else}
      <ChatInlineIndicator labelOnly class="min-w-0 shrink">
        {#snippet children()}
          <span class="tool-summary-text" title={summaryParts.text}>{summaryParts.text}</span>
        {/snippet}
      </ChatInlineIndicator>
    {/if}
  {/if}
</div>
