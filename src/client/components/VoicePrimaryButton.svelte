<script lang="ts">
  import { ArrowUp, Loader2, Mic } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'
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
    if (phase === 'transcribing') return $t('chat.voice.stateTranscribing')
    if (phase === 'arming') return $t('chat.voice.preparingMicrophone')
    if (phase === 'recording') return $t('chat.voice.sendVoiceMessage')
    return $t('chat.voice.startRecording')
  }
</script>

<div
  class="voice-primary-hit box-border flex h-full min-w-[33%] items-center justify-end [padding-right:max(12px,env(safe-area-inset-right,0px))]"
>
  <button
    type="button"
    class={cn(
      'voice-primary relative flex h-[52px] w-[52px] shrink-0 cursor-pointer items-center justify-center border-none p-0 text-white touch-manipulation select-none [-webkit-tap-highlight-color:transparent] [box-shadow:0_2px_10px_rgba(0,0,0,0.2)] [transition:background-color_200ms_ease,box-shadow_200ms_ease] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent active:enabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-55 disabled:transform-none',
      (phase === 'idle' || phase === 'arming') && 'voice-primary--rest bg-[var(--accent,#6366f1)]',
      phase === 'recording' &&
        'voice-primary--rec bg-[var(--accent,#6366f1)] [box-shadow:0_2px_10px_color-mix(in_srgb,var(--accent,#6366f1)_40%,rgba(0,0,0,0.15))]',
      phase === 'transcribing' && 'voice-primary--busy',
      holdGated && 'voice-primary--gated disabled:opacity-45',
    )}
    disabled={blocked || phase === 'arming' || phase === 'transcribing'}
    aria-busy={phase === 'transcribing'}
    aria-label={ariaPrimary()}
    onclick={() => void onPrimary()}
  >
    <span
      class="voice-primary-pulse pointer-events-none absolute inset-0 opacity-0"
      aria-hidden="true"
      data-active={phase === 'recording'}
      data-key={pulseKey}
    ></span>
    <span class="voice-primary-icons relative grid h-full w-full place-items-center text-white">
      {#if phase === 'transcribing'}
        <span
          class="voice-primary-icon-layer voice-primary-icon-layer--show grid place-items-center opacity-100 transition-opacity duration-150 [filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.15))] [grid-area:1/1]"
        >
          <Loader2 size={26} strokeWidth={2} aria-hidden="true" />
        </span>
      {:else}
        <span
          class={cn(
            'voice-primary-icon-layer grid place-items-center opacity-0 transition-opacity duration-150 [filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.15))] [grid-area:1/1]',
            (phase === 'idle' || phase === 'arming') && 'voice-primary-icon-layer--show opacity-100',
          )}
        >
          <Mic size={26} strokeWidth={2} aria-hidden="true" />
        </span>
        <span
          class={cn(
            'voice-primary-icon-layer voice-primary-send-wrap grid place-items-center opacity-0 transition-opacity duration-150 [filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.15))] [grid-area:1/1] [&_svg]:block',
            phase === 'recording' && 'voice-primary-icon-layer--show opacity-100',
          )}
        >
          <ArrowUp size={22} strokeWidth={2.5} aria-hidden="true" />
        </span>
      {/if}
    </span>
  </button>
</div>

<style>
  /* Pseudo-element animation for the active pulse ring. */
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
