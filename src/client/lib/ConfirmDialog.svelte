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
  <div
    class="cd-backdrop"
    onclick={onDismiss}
    role="presentation"
  >
    <div
      class="cd-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <h2 id={titleId} class="cd-title">{title}</h2>
      <div class="cd-body">
        {@render children()}
      </div>
      <div class="cd-actions">
        <button type="button" class="cd-btn" onclick={onDismiss}>
          {cancelLabel}
        </button>
        <button
          type="button"
          class="cd-btn"
          class:cd-btn--danger={confirmVariant === 'danger'}
          onclick={() => onConfirm()}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Token-based (no Tailwind) so the modal always matches app chrome in any host / scan order. */
  .cd-backdrop {
    position: fixed;
    inset: 0;
    z-index: 400;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    padding: 1rem;
    box-sizing: border-box;
  }

  .cd-panel {
    width: 100%;
    max-width: 22rem;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
    padding: 1rem 1rem 0.75rem;
    box-sizing: border-box;
  }

  .cd-title {
    margin: 0 0 0.4rem;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--text);
  }

  .cd-body {
    margin: 0 0 0.9rem;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-2);
    word-break: break-word;
  }

  .cd-body :global(p) {
    margin: 0;
  }

  .cd-body :global(p + p) {
    margin-top: 0.5rem;
  }

  .cd-actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .cd-btn {
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.2;
    padding: 0.4rem 0.75rem;
    border-radius: 0.375rem;
    border: 1px solid var(--border);
    background: var(--bg-3);
    color: var(--text);
    transition: background 0.1s ease, border-color 0.1s ease, color 0.1s ease;
  }

  .cd-btn:hover {
    background: var(--bg-2);
  }

  .cd-btn--danger {
    border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
    background: color-mix(in srgb, var(--danger) 12%, var(--bg));
    color: var(--danger);
  }

  .cd-btn--danger:hover {
    background: color-mix(in srgb, var(--danger) 22%, var(--bg));
  }
</style>
