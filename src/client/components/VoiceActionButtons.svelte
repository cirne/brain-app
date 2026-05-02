<script lang="ts">
  import { RotateCcw, X } from 'lucide-svelte'

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
</script>

<div class="voice-actions" class:voice-actions--show={visible} aria-hidden={!visible}>
  <!-- Order: Cancel, then Restart (left → right) -->
  <button
    type="button"
    class="voice-chip voice-chip--ghost voice-chip--icon-only"
    disabled={disabled || !visible}
    aria-label="Cancel recording"
    onclick={onCancel}
  >
    <X size={16} strokeWidth={2.25} class="voice-chip-ic" aria-hidden="true" />
  </button>
  <button
    type="button"
    class="voice-chip voice-chip--icon-only"
    disabled={disabled || !visible}
    aria-label="Restart recording"
    onclick={() => void onRestart()}
  >
    <RotateCcw size={16} strokeWidth={2.25} class="voice-chip-ic" aria-hidden="true" />
  </button>
</div>

<style>
  .voice-actions {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    flex-wrap: nowrap;
    gap: 8px;
    min-width: 0;
    max-width: 0;
    padding-left: 0;
    overflow: hidden;
    opacity: 0;
    transform: translateX(-8px);
    pointer-events: none;
    transition:
      max-width 120ms ease-in,
      opacity 120ms ease-in,
      transform 120ms ease-in,
      padding 120ms ease-in;
  }

  .voice-actions--show {
    max-width: 320px;
    padding-left: max(10px, env(safe-area-inset-left, 0px));
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
    transition:
      max-width 180ms ease-out,
      opacity 180ms ease-out,
      transform 180ms ease-out,
      padding 180ms ease-out;
  }

  .voice-chip--icon-only {
    gap: 0;
    min-width: 40px;
    width: 40px;
    padding: 0;
  }

  .voice-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 12px;
font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--text);
    background: color-mix(in srgb, var(--bg-elevated, var(--bg)) 92%, transparent);
    border: 1px solid var(--border-1, rgba(0, 0, 0, 0.12));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    box-sizing: border-box;
    white-space: nowrap;
  }

  .voice-chip--ghost {
    background: transparent;
    box-shadow: none;
    font-weight: 500;
    color: var(--text-2);
  }

  .voice-chip:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .voice-chip:not(:disabled):active {
    transform: scale(0.97);
  }

  .voice-chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  :global(.voice-chip-ic) {
    flex-shrink: 0;
    opacity: 0.9;
  }
</style>
