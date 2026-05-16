<script lang="ts">
  import { FileText } from '@lucide/svelte'
  import ChatInlineIndicator from './ChatInlineIndicator.svelte'

  let {
    labelOnly = false,
    variant = 'default' as 'default' | 'error',
    withIcon = true,
    iconBang = false,
  }: {
    labelOnly?: boolean
    variant?: 'default' | 'error'
    withIcon?: boolean
    iconBang?: boolean
  } = $props()
</script>

<div class="tool-call-row">
  <ChatInlineIndicator {labelOnly} {variant}>
    {#snippet icon()}
      {#if iconBang}
        !
      {:else if withIcon}
        <FileText size={12} strokeWidth={2.5} />
      {/if}
    {/snippet}
    {#snippet children()}
      <span class="tool-name">Read file</span>
    {/snippet}
  </ChatInlineIndicator>
</div>
