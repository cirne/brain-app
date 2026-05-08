<script lang="ts">
  import ConfirmDialog from '@components/ConfirmDialog.svelte'

  type Props = {
    open: boolean
    title: string
    initialText: string
    saveLabel?: string
    onDismiss: () => void
    onSave: (_text: string) => void | Promise<void>
  }

  let {
    open,
    title,
    initialText,
    saveLabel = 'Save policy',
    onDismiss,
    onSave,
  }: Props = $props()

  let draft = $state('')
  let busy = $state(false)

  $effect(() => {
    if (open) draft = initialText
  })

  async function save(): Promise<void> {
    const t = draft.trim()
    if (!t || busy) return
    busy = true
    try {
      await onSave(t)
      onDismiss()
    } finally {
      busy = false
    }
  }
</script>

<ConfirmDialog
  {open}
  {title}
  titleId="brain-policy-editor-title"
  confirmLabel={busy ? 'Saving…' : saveLabel}
  cancelLabel="Cancel"
  panelClass="max-w-[36rem]"
  onDismiss={() => {
    if (!busy) onDismiss()
  }}
  onConfirm={() => void save()}
>
  <p class="text-[0.8125rem] text-muted">
    This text is guidance for your assistant when someone queries your brain under this policy.
  </p>
  <label class="mt-2 flex flex-col gap-1">
    <span class="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">Privacy guidance</span>
    <textarea
      class="min-h-[12rem] w-full rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface p-2 text-[0.8125rem] leading-snug text-foreground"
      bind:value={draft}
      disabled={busy}
    ></textarea>
  </label>
</ConfirmDialog>
