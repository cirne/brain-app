<script lang="ts">
  import ConfirmDialog from '../ConfirmDialog.svelte'

  let {
    open,
    title,
    titleId,
    confirmLabel,
    cancelLabel,
    confirmVariant,
    onDismiss,
    onConfirm,
    bodyText = 'Test body',
    useCustomActions = false,
    onExtra = () => {},
    panelClass,
  }: {
    open: boolean
    title: string
    titleId?: string
    confirmLabel?: string
    cancelLabel?: string
    confirmVariant?: 'default' | 'danger'
    onDismiss: () => void
    onConfirm: () => void
    bodyText?: string
    useCustomActions?: boolean
    onExtra?: () => void
    panelClass?: string
  } = $props()
</script>

{#if useCustomActions}
  <ConfirmDialog
    {open}
    {title}
    {titleId}
    {confirmLabel}
    {cancelLabel}
    {confirmVariant}
    {onDismiss}
    {onConfirm}
    {panelClass}
  >
    {#snippet children()}
      <p>{bodyText}</p>
    {/snippet}
    {#snippet actions()}
      <button type="button" class="cd-btn" onclick={onExtra}>Extra</button>
    {/snippet}
  </ConfirmDialog>
{:else}
  <ConfirmDialog
    {open}
    {title}
    {titleId}
    {confirmLabel}
    {cancelLabel}
    {confirmVariant}
    {onDismiss}
    {onConfirm}
    {panelClass}
  >
    {#snippet children()}
      <p>{bodyText}</p>
    {/snippet}
  </ConfirmDialog>
{/if}
