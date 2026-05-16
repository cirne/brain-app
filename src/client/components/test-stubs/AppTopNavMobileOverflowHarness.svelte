<script lang="ts">
  import { Circle } from '@lucide/svelte'
  import AppTopNav from '../AppTopNav.svelte'
  import AnchoredMenuRow from '../shell/AnchoredMenuRow.svelte'

  const noop = () => {}

  const baseProps = {
    onToggleSidebar: noop,
    syncErrors: [] as string[],
    showSyncErrors: false,
    onOpenSearch: noop,
    onToggleSyncErrors: noop,
    onOpenHub: noop,
    onNewChat: noop,
    isEmptyChat: false,
    isMobile: true,
    mobileCenterTitle: 'Title',
  }
</script>

{#snippet mobileOverflow({ dismiss }: { dismiss: () => void })}
  <AnchoredMenuRow label="Test row" onclick={dismiss}>
    {#snippet leading()}
      <Circle size={18} strokeWidth={2} aria-hidden="true" />
    {/snippet}
  </AnchoredMenuRow>
{/snippet}

<AppTopNav {...baseProps} {mobileOverflow} />
