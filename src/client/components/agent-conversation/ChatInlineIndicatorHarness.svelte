<script lang="ts">
  import { FileText } from 'lucide-svelte'
  import ChatInlineIndicator from './ChatInlineIndicator.svelte'

  let {
    labelOnly = false,
    variant = 'default' as 'default' | 'error',
    withIcon = true,
    iconBang = false,
    inlineMetrics = 'default' as 'default' | 'inherit',
  }: {
    labelOnly?: boolean
    variant?: 'default' | 'error'
    withIcon?: boolean
    iconBang?: boolean
    inlineMetrics?: 'default' | 'inherit'
  } = $props()
</script>

<ChatInlineIndicator {labelOnly} {variant} {inlineMetrics}>
  {#snippet icon()}
    {#if iconBang}
      !
    {:else if withIcon}
      <FileText size={12} strokeWidth={2.5} />
    {/if}
  {/snippet}
  {#snippet children()}
    Read file
  {/snippet}
</ChatInlineIndicator>
