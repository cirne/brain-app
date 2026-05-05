<script lang="ts">
  import type { Snippet } from 'svelte'

  /**
   * Render under `document.body` so `position:fixed` coords from `getBoundingClientRect()`
   * match the viewport. Ancestors with `transform` (e.g. mobile SlideOver `translateX`)
   * otherwise pin fixed descendants to the wrong box and the menu sits too low / offset.
   */
  function portalAnchoredMenuToBody(host: HTMLElement) {
    globalThis.document.body.appendChild(host)
    return () => host.remove()
  }

  type Props = {
    open: boolean
    onDismiss: () => void
    /** Element whose bottom-right anchors the menu (typically the ⋯ button). */
    anchorEl: HTMLElement | null
    /** Screen reader label for the menu panel */
    menuLabel?: string
    children: Snippet
    /** Optional class on the floating panel */
    panelClass?: string
  }

  let {
    open,
    onDismiss,
    anchorEl,
    menuLabel = 'Actions',
    children,
    panelClass,
  }: Props = $props()

  const panelStyle = $derived.by(() => {
    if (!open || !anchorEl || typeof globalThis.window === 'undefined') return ''
    const r = anchorEl.getBoundingClientRect()
    const margin = 8
    const maxW = 288
    const width = Math.min(maxW, globalThis.window.innerWidth - 2 * margin)
    const right = globalThis.window.innerWidth - r.right
    const top = r.bottom + 4
    return [
      `top:${top}px`,
      `right:${Math.max(margin, right)}px`,
      `width:${width}px`,
      `max-height:min(70vh,420px)`,
    ].join(';')
  })

  function onWindowKeydown(e: KeyboardEvent) {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss()
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if open && anchorEl}
  <div
    class="anchored-action-menu-portal pointer-events-none fixed inset-0 z-[520]"
    {@attach portalAnchoredMenuToBody}
  >
    <!-- Capture backdrop: closes menu -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="pointer-events-auto fixed inset-0 z-0 bg-transparent"
      role="presentation"
      aria-hidden="true"
      onclick={onDismiss}
    ></div>
    <div
      class={[
        'pointer-events-auto fixed z-[1] overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-[0_8px_32px_rgba(0,0,0,0.35)] [box-sizing:border-box]',
        panelClass ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={panelStyle}
      role="menu"
      aria-label={menuLabel}
      tabindex="-1"
    >
      {@render children()}
    </div>
  </div>
{/if}
