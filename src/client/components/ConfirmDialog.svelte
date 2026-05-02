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
      if (typeof el.showModal === 'function') {
        try {
          el.showModal()
          return
        } catch {
          /* allow without transient user gesture in strict hosts */
        }
      }
      el.setAttribute('open', '')
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
</script>

{#if open}
  <!--
    Native `<dialog>` + showModal(): browser top layer, above sibling stacking contexts (e.g. chat vs detail pane).
    See https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal
  -->
  <dialog
    bind:this={dialogEl}
    class="cd-modal-shell"
    aria-modal="true"
    aria-labelledby={titleId}
    oncancel={onDialogCancel}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="cd-backdrop" role="presentation" onclick={onBackdropClick}></div>

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class={['cd-panel', panelClass].filter(Boolean).join(' ')} onclick={onPanelClick}>
      <h2 id={titleId} class="cd-title">{title}</h2>
      <div class="cd-body">
        {@render children()}
      </div>
      <div class="cd-actions">
        {#if actions}
          {@render actions()}
        {:else}
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
        {/if}
      </div>
    </div>
  </dialog>
{/if}

<style>
  .cd-modal-shell {
    margin: 0;
    padding: 1rem;
    border: none;
    max-width: none;
    max-height: none;
    width: 100%;
    height: 100%;
    max-width: 100vw;
    max-height: 100vh;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: transparent;
    position: fixed;
    inset: 0;
  }

  /* Top-layer dimming (modal); covers the viewport including high-z split panes */
  .cd-modal-shell::backdrop {
    background: rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }

  /* Click target “outside” the card (transparent; ::backdrop receives no pointer events above some browsers) */
  .cd-backdrop {
    position: absolute;
    inset: 0;
    z-index: 0;
    cursor: pointer;
  }

  .cd-panel {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 22rem;
    cursor: auto;
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
    transition:
      background 0.1s ease,
      border-color 0.1s ease,
      color 0.1s ease;
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

  .cd-btn--primary {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
    transition:
      background 0.1s ease,
      border-color 0.1s ease,
      filter 0.1s ease;
  }

  .cd-btn--primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  /* Buttons with `.cd-btn` may render in `.cd-body` (e.g. per-row copy) or `.cd-actions`. */
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
    transition:
      background 0.1s ease,
      border-color 0.1s ease,
      color 0.1s ease;
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
