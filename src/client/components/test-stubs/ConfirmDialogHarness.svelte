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
  } = $props()
</script>

<ConfirmDialog
  {open}
  {title}
  {titleId}
  {confirmLabel}
  {cancelLabel}
  {confirmVariant}
  {onDismiss}
  {onConfirm}
>
  {#snippet children()}
    <p>{bodyText}</p>
  {/snippet}
</ConfirmDialog>
