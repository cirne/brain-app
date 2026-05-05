<script lang="ts">
  import { Circle } from 'lucide-svelte'
  import AnchoredActionMenu from '../shell/AnchoredActionMenu.svelte'
  import AnchoredMenuRow from '../shell/AnchoredMenuRow.svelte'

  let triggerEl = $state<HTMLButtonElement | null>(null)
  let open = $state(false)
</script>

<button bind:this={triggerEl} type="button" onclick={() => { open = !open }}>Open</button>

<AnchoredActionMenu {open} anchorEl={triggerEl} menuLabel="Test menu" onDismiss={() => { open = false }}>
  {#snippet children()}
    <AnchoredMenuRow label="Alpha" onclick={() => {}}>
      {#snippet leading()}
        <Circle size={18} strokeWidth={2} aria-hidden="true" />
      {/snippet}
    </AnchoredMenuRow>
  {/snippet}
</AnchoredActionMenu>
