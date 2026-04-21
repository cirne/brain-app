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
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="confirm-dialog-backdrop" onclick={onDismiss} role="presentation">
    <div
      class="confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <h2 id={titleId} class="confirm-dialog-title">{title}</h2>
      <div class="confirm-dialog-body">
        {@render children()}
      </div>
      <div class="confirm-dialog-actions">
        <button type="button" class="confirm-dialog-btn" onclick={onDismiss}>
          {cancelLabel}
        </button>
        <button
          type="button"
          class="confirm-dialog-btn confirm-dialog-btn-confirm"
          class:confirm-dialog-btn-danger={confirmVariant === 'danger'}
          onclick={() => onConfirm()}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 400;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 0, 0, 0.45);
  }

  .confirm-dialog {
    width: min(100%, 340px);
    padding: 16px 16px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  }

  .confirm-dialog-title {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 6px;
    color: var(--text);
  }

  .confirm-dialog-body {
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-2);
    margin: 0 0 14px;
    word-break: break-word;
  }

  .confirm-dialog-body :global(p) {
    margin: 0;
    font-size: inherit;
    line-height: inherit;
    color: inherit;
  }

  .confirm-dialog-body :global(p + p) {
    margin-top: 8px;
  }

  .confirm-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .confirm-dialog-btn {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid var(--border);
    background: var(--bg-3);
    color: var(--text);
    transition:
      background 0.12s,
      border-color 0.12s;
    cursor: pointer;
  }

  .confirm-dialog-btn:hover {
    background: var(--bg-2);
  }

  .confirm-dialog-btn-confirm.confirm-dialog-btn-danger {
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
    background: color-mix(in srgb, var(--danger) 12%, var(--bg));
    color: var(--danger);
  }

  .confirm-dialog-btn-confirm.confirm-dialog-btn-danger:hover {
    background: color-mix(in srgb, var(--danger) 22%, var(--bg));
  }
</style>
