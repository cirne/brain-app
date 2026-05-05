<script lang="ts">
  import BottomSheet from '@components/shell/BottomSheet.svelte'

  let {
    open = true,
    title = 'Sheet',
    onDismiss,
  }: {
    open?: boolean
    title?: string
    onDismiss: () => void
  } = $props()
</script>

<BottomSheet {open} {title} {onDismiss}>
  {#snippet children()}
    <p class="sheet-inner px-4 py-2 text-sm text-foreground">Inside sheet</p>
  {/snippet}
</BottomSheet>
