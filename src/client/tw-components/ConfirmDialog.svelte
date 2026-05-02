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

  /** Non-null while `{#if open}` — synced with `.showModal()` for top-layer stacking above split panes. */
  let dialogEl = $state<HTMLDialogElement | null>(null)

  $effect(() => {
    const el = dialogEl
    if (!el || !open) return

    function openModal() {
      if (typeof el!.showModal === 'function') {
        try {
          el!.showModal()
          return
        } catch {
          /* allow without transient user gesture in strict hosts */
        }
      }
      el!.setAttribute('open', '')
    }

    if (!el.open) openModal()
  })

  function onDialogCancel(e: Event) {
    e.preventDefault()
    onDismiss()
  }

  function onBackdropClick() {
    onDismiss()
  }

  function onPanelClick(e: MouseEvent) {
    e.stopPropagation()
  }

  const btnBase =
    'cd-btn cursor-pointer border border-border bg-surface-3 px-3 py-[0.4rem] text-xs font-medium leading-tight text-foreground transition-colors hover:bg-surface-2 [font:inherit] disabled:cursor-not-allowed disabled:opacity-50'
  const btnDanger =
    'cd-btn--danger border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_12%,var(--bg))] text-danger hover:bg-[color-mix(in_srgb,var(--danger)_22%,var(--bg))]'
</script>

{#if open}
  <!--
    Native `<dialog>` + showModal(): browser top layer, above sibling stacking contexts (e.g. chat vs detail pane).
    See https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal
  -->
  <dialog
    bind:this={dialogEl}
    class="cd-modal-shell fixed inset-0 m-0 box-border flex h-full max-h-screen w-full max-w-screen items-center justify-center overflow-hidden border-none bg-transparent p-4"
    aria-modal="true"
    aria-labelledby={titleId}
    oncancel={onDialogCancel}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="cd-backdrop absolute inset-0 z-0 cursor-pointer"
      role="presentation"
      onclick={onBackdropClick}
    ></div>

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={cn(
        'cd-panel relative z-[1] box-border w-full max-w-[22rem] cursor-auto border border-border bg-surface px-4 pt-4 pb-3 [box-shadow:0_12px_40px_rgba(0,0,0,0.25)]',
        panelClass,
      )}
      onclick={onPanelClick}
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
  </dialog>
{/if}

<style>
  /* Top-layer dimming (modal); covers the viewport including high-z split panes. */
  .cd-modal-shell::backdrop {
    background: rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }

  /* Style buttons rendered inside the dialog body / actions snippet by their semantic class names. */
  .cd-panel :global(button.cd-btn) {
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.2;
    padding: 0.4rem 0.75rem;
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
