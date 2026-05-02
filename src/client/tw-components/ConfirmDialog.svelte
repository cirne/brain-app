<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '@client/lib/cn.js'

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
    /** When set, replaces the default Cancel/Confirm row. Backdrop click and Escape still call `onDismiss`. */
    actions?: Snippet
    /** Extra class on `.cd-panel` (e.g. width presets from the parent). */
    panelClass?: string
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
    actions,
    panelClass,
  }: Props = $props()

  function onWindowKeydown(e: KeyboardEvent) {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
    }
  }

  const btnBase =
    'cd-btn cursor-pointer rounded-md border border-border bg-surface-3 px-3 py-[0.4rem] text-xs font-medium leading-tight text-foreground transition-colors hover:bg-surface-2 [font:inherit] disabled:cursor-not-allowed disabled:opacity-50'
  const btnDanger =
    'cd-btn--danger border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_12%,var(--bg))] text-danger hover:bg-[color-mix(in_srgb,var(--danger)_22%,var(--bg))]'
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="cd-backdrop fixed inset-0 z-[400] box-border flex items-center justify-center bg-black/45 p-4"
    onclick={onDismiss}
    role="presentation"
  >
    <div
      class={cn(
        'cd-panel box-border w-full max-w-[22rem] rounded-[10px] border border-border bg-surface px-4 pt-4 pb-3 [box-shadow:0_12px_40px_rgba(0,0,0,0.25)]',
        panelClass,
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <h2 id={titleId} class="cd-title m-0 mb-[0.4rem] text-sm font-semibold leading-tight text-foreground">{title}</h2>
      <div class="cd-body mb-[0.9rem] mt-0 text-xs leading-snug text-muted [overflow-wrap:anywhere] [&>p+p]:mt-2 [&>p]:m-0">
        {@render children()}
      </div>
      <div class="cd-actions flex flex-wrap justify-end gap-[0.4rem]">
        {#if actions}
          {@render actions()}
        {:else}
          <button type="button" class={btnBase} onclick={onDismiss}>
            {cancelLabel}
          </button>
          <button
            type="button"
            class={cn(btnBase, confirmVariant === 'danger' && btnDanger)}
            onclick={() => onConfirm()}
          >
            {confirmLabel}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Style buttons rendered inside the dialog body / actions snippet by their semantic class names. */
  .cd-panel :global(button.cd-btn) {
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

  .cd-panel :global(button.cd-btn--primary) {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
    transition:
      background 0.1s ease,
      border-color 0.1s ease,
      filter 0.1s ease;
  }

  .cd-panel :global(button.cd-btn--primary:hover:not(:disabled)) {
    filter: brightness(1.08);
  }

  .cd-panel :global(button.cd-btn:not(.cd-btn--primary):not(.cd-btn--danger):hover:not(:disabled)) {
    background: var(--bg-2);
  }

  .cd-panel :global(button.cd-btn:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
