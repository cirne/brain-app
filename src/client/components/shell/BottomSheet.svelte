<script lang="ts">
  import type { Snippet } from 'svelte'

  type Props = {
    open: boolean
    /** Screen reader label / visible sheet title */
    title: string
    titleId?: string
    onDismiss: () => void
    children: Snippet
    /** Extra class on the sheet panel */
    panelClass?: string
  }

  let {
    open,
    title,
    titleId = 'bottom-sheet-title',
    onDismiss,
    children,
    panelClass,
  }: Props = $props()

  let dialogEl = $state<HTMLDialogElement | null>(null)

  $effect(() => {
    console.log('[effect-debug]', 'src/client/components/shell/BottomSheet.svelte', '#1')
    const el = dialogEl
    if (!el || !open) return

    function openModal() {
      if (typeof el!.showModal === 'function') {
        try {
          el!.showModal()
          return
        } catch {
          /* strict hosts */
        }
      }
      el!.setAttribute('open', '')
    }

    if (!el.open) openModal()

    queueMicrotask(() => {
      const focusable = el?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      focusable?.focus()
    })
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
  <!-- Native dialog top layer (same pattern as ConfirmDialog). -->
  <dialog
    bind:this={dialogEl}
    class="bs-modal-shell fixed inset-0 z-[400] m-0 box-border flex h-full max-h-none w-full max-w-none items-end justify-center overflow-hidden border-none bg-transparent p-0"
    aria-modal="true"
    aria-labelledby={titleId}
    oncancel={onDialogCancel}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bs-backdrop absolute inset-0 z-0 cursor-pointer bg-black/45"
      role="presentation"
      onclick={onBackdropClick}
    ></div>

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={[
        'bs-panel relative z-[1] box-border max-h-[min(70vh,520px)] w-full cursor-auto overflow-hidden rounded-t-xl border border-border border-b-0 bg-surface shadow-[0_-8px_32px_rgba(0,0,0,0.28)]',
        panelClass ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      onclick={onPanelClick}
    >
      <div class="bs-handle-row flex justify-center pt-2 pb-1" aria-hidden="true">
        <span class="inline-block h-1 w-10 rounded-full bg-border"></span>
      </div>
      <h2
        id={titleId}
        class="bs-title m-0 border-b border-border px-4 pb-2 pt-0 text-sm font-semibold leading-tight text-foreground"
      >
        {title}
      </h2>
      <div
        class="bs-body max-h-[min(56vh,460px)] overflow-y-auto px-2 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {@render children()}
      </div>
    </div>
  </dialog>
{/if}

<style>
  /* Bottom-sheet dialog: no extra padding; panel is flush to bottom. */
  .bs-modal-shell::backdrop {
    background: transparent;
  }
</style>
