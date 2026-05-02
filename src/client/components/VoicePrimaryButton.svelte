<script lang="ts">
  import { ArrowUp, Loader2, Mic } from 'lucide-svelte'
  import type { VoiceTapPhase } from '@client/lib/voiceTapCapture.js'

  let {
    phase,
    disabled = false,
    holdGated = false,
    pulseKey = 0,
    onPrimary,
  }: {
    phase: VoiceTapPhase
    disabled?: boolean
    holdGated?: boolean
    /** Bump to reset pulse ring animation after restart. */
    pulseKey?: number
    onPrimary: () => void | Promise<void>
  } = $props()

  const blocked = $derived(disabled || holdGated)

  function ariaPrimary(): string {
    if (phase === 'transcribing') return 'Transcribing'
    if (phase === 'arming') return 'Preparing microphone'
    if (phase === 'recording') return 'Send voice message'
    return 'Start recording'
  }
</script>

<div class="voice-primary-hit">
  <button
    type="button"
    class="voice-primary"
    class:voice-primary--rest={phase === 'idle' || phase === 'arming'}
    class:voice-primary--rec={phase === 'recording'}
    class:voice-primary--busy={phase === 'transcribing'}
    class:voice-primary--gated={holdGated}
    disabled={blocked || phase === 'arming' || phase === 'transcribing'}
    aria-busy={phase === 'transcribing'}
    aria-label={ariaPrimary()}
    onclick={() => void onPrimary()}
  >
    <span class="voice-primary-pulse" aria-hidden="true" data-active={phase === 'recording'} data-key={pulseKey}
    ></span>
    <span class="voice-primary-icons">
      {#if phase === 'transcribing'}
        <span class="voice-primary-icon-layer voice-primary-icon-layer--show">
          <Loader2 size={26} strokeWidth={2} aria-hidden="true" />
        </span>
      {:else}
        <span
          class="voice-primary-icon-layer"
          class:voice-primary-icon-layer--show={phase === 'idle' || phase === 'arming'}
        >
          <Mic size={26} strokeWidth={2} aria-hidden="true" />
        </span>
        <span
          class="voice-primary-icon-layer voice-primary-send-wrap"
          class:voice-primary-icon-layer--show={phase === 'recording'}
        >
          <ArrowUp size={22} strokeWidth={2.5} aria-hidden="true" />
        </span>
      {/if}
    </span>
  </button>
</div>

<style>
  .voice-primary-hit {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 33%;
    height: 100%;
    padding-right: max(12px, env(safe-area-inset-right, 0px));
    box-sizing: border-box;
  }

  .voice-primary {
    position: relative;
    display: flex;
    width: 52px;
    height: 52px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
cursor: pointer;
    color: #fff;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    transition:
      background-color 200ms ease,
      box-shadow 200ms ease;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    user-select: none;
  }

  .voice-primary--rest {
    background: var(--accent, #6366f1);
  }

  .voice-primary--rec {
    /* Match text Send (AgentInput .send-btn): commit / outbound, not “stop” */
    background: var(--accent, #6366f1);
    box-shadow: 0 2px 10px color-mix(in srgb, var(--accent, #6366f1) 40%, rgba(0, 0, 0, 0.15));
  }

  .voice-primary:not(:disabled):active {
    transform: scale(0.96);
  }

  .voice-primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    transform: none;
  }

  .voice-primary--gated:disabled {
    opacity: 0.45;
  }

  .voice-primary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .voice-primary-icons {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    color: #fff;
  }

  .voice-primary-icon-layer {
    grid-area: 1 / 1;
    display: grid;
    place-items: center;
    opacity: 0;
    transition: opacity 150ms ease;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.15));
  }

  .voice-primary-icon-layer--show {
    opacity: 1;
  }

  .voice-primary-send-wrap :global(svg) {
    display: block;
  }

  .voice-primary-pulse {
    position: absolute;
    inset: 0;
pointer-events: none;
    opacity: 0;
  }

  .voice-primary-pulse[data-active='true']::after {
    content: '';
    position: absolute;
    inset: 0;
border: 2px solid color-mix(in srgb, var(--accent, #6366f1) 35%, transparent);
    animation: voice-pulse-ring 1.4s ease-out infinite;
  }

  @keyframes voice-pulse-ring {
    0% {
      transform: scale(1);
      opacity: 0.4;
    }
    100% {
      transform: scale(1.6);
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .voice-primary-pulse[data-active='true']::after {
      animation: none;
      opacity: 0;
    }
  }
</style>
