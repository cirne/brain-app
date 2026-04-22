<script lang="ts">
  import type { Snippet } from 'svelte'

  type Props = {
    open: boolean
    title: string
    titleId?: string
    confirmLabel?: string
    cancelLabel?: string
    /** `danger` styles the confirm action like delete/destructive flows. */
    confirmVariant?: 'default' | 'danger'
    onDismiss: () => void
    onConfirm: () => void
    children: Snippet
  }

  let {
    open,
    title,
    titleId = 'confirm-dialog-title',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    confirmVariant = 'default',
    onDismiss,
    onConfirm,
    children,
  }: Props = $props()

  function onWindowKeydown(e: KeyboardEvent) {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
    }
  }

  const confirmBtnClass = $derived(
    confirmVariant === 'danger'
      ? 'cursor-pointer rounded-md border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_12%,var(--bg))] px-3 py-1.5 text-xs font-medium text-danger transition-[background] duration-100 hover:bg-[color-mix(in_srgb,var(--danger)_22%,var(--bg))]'
      : 'cursor-pointer rounded-md border border-border bg-surface-3 px-3 py-1.5 text-xs font-medium text-foreground transition-[background,border-color] duration-100 hover:bg-surface-2',
  )
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-[400] flex items-center justify-center bg-black/45 p-4"
    onclick={onDismiss}
    role="presentation"
  >
    <div
      class="w-full max-w-[340px] rounded-[10px] border border-border bg-surface p-4 pb-3 shadow-[0_12px_40px_rgba(0,0,0,0.25)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <h2 id={titleId} class="m-0 mb-1.5 text-sm font-semibold text-foreground">{title}</h2>
      <div
        class="confirm-dialog-body mb-3.5 text-xs leading-snug break-words text-muted [&_p]:m-0 [&_p]:text-inherit [&_p]:leading-inherit [&_p+p]:mt-2"
      >
        {@render children()}
      </div>
      <div class="flex justify-end gap-1.5">
        <button
          type="button"
          class="cursor-pointer rounded-md border border-border bg-surface-3 px-3 py-1.5 text-xs font-medium text-foreground transition-[background,border-color] duration-100 hover:bg-surface-2"
          onclick={onDismiss}
        >
          {cancelLabel}
        </button>
        <button type="button" class={confirmBtnClass} onclick={() => onConfirm()}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
