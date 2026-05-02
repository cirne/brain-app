<script lang="ts">
  import { RotateCcw, X } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'

  let {
    visible = false,
    disabled = false,
    onRestart,
    onCancel,
  }: {
    visible: boolean
    disabled?: boolean
    onRestart: () => void | Promise<void>
    onCancel: () => void
  } = $props()

  const chipBase =
    'voice-chip voice-chip--icon-only box-border inline-flex h-10 w-10 min-w-[40px] cursor-pointer items-center justify-center whitespace-nowrap border border-[var(--border-1,rgba(0,0,0,0.12))] bg-[color-mix(in_srgb,var(--bg-elevated,var(--bg))_92%,transparent)] p-0 text-foreground touch-manipulation [-webkit-tap-highlight-color:transparent] [box-shadow:0_1px_2px_rgba(0,0,0,0.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:enabled:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40'
</script>

<div
  class={cn(
    'voice-actions flex min-w-0 max-w-0 flex-nowrap items-center justify-start gap-2 overflow-hidden pl-0 opacity-0 [transform:translateX(-8px)] [transition:max-width_120ms_ease-in,opacity_120ms_ease-in,transform_120ms_ease-in,padding_120ms_ease-in] pointer-events-none',
    visible &&
      'voice-actions--show max-w-[320px] opacity-100 [transform:translateX(0)] pointer-events-auto [padding-left:max(10px,env(safe-area-inset-left,0px))] [transition:max-width_180ms_ease-out,opacity_180ms_ease-out,transform_180ms_ease-out,padding_180ms_ease-out]',
  )}
  aria-hidden={!visible}
>
  <!-- Order: Cancel, then Restart (left → right) -->
  <button
    type="button"
    class={cn(chipBase, 'voice-chip--ghost border-transparent bg-transparent font-medium text-muted [box-shadow:none]')}
    disabled={disabled || !visible}
    aria-label="Cancel recording"
    onclick={onCancel}
  >
    <X size={16} strokeWidth={2.25} class="voice-chip-ic" aria-hidden="true" />
  </button>
  <button
    type="button"
    class={chipBase}
    disabled={disabled || !visible}
    aria-label="Restart recording"
    onclick={() => void onRestart()}
  >
    <RotateCcw size={16} strokeWidth={2.25} class="voice-chip-ic" aria-hidden="true" />
  </button>
</div>

<style>
  /* Lucide icon class — must escape Svelte's scoped CSS so the icon class still applies. */
  :global(.voice-chip-ic) {
    flex-shrink: 0;
    opacity: 0.9;
  }
</style>
