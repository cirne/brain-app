<script lang="ts">
  import { FileText } from 'lucide-svelte'
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

<ChatInlineIndicator {labelOnly} {variant}>
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
