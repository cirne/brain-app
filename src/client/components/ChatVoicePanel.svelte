<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { Keyboard, Loader2 } from 'lucide-svelte'
  import { formatRecordingDuration } from '@client/lib/voicePanelFormat.js'
  import { VoiceTapRecorder, type VoiceTapPhase } from '@client/lib/voiceTapCapture.js'
  import VoiceActionButtons from './VoiceActionButtons.svelte'
  import VoicePrimaryButton from './VoicePrimaryButton.svelte'
  import RecordingWaveformIndicator from './RecordingWaveformIndicator.svelte'

  let {
    disabled = false,
    holdGated = false,
    hearReplies = true,
    /**
     * `fixed` — viewport-bottom dock (legacy). `inline` — flow between context pills and composer (legacy).
     * `composer-flow` — single embedded row in the chat composer stack.
     */
    layout = 'fixed' as 'fixed' | 'inline' | 'composer-flow',
    /** When {@link layout} is `composer-flow` and phase is idle: switch back to text entry. */
    onExitVoiceMode = undefined as (() => void) | undefined,
    /** After mount, begin arming/recording immediately (mic entry from unified composer). */
    autoStartRecording = false,
    onTranscribe,
  }: {
    disabled?: boolean
    holdGated?: boolean
    hearReplies?: boolean
    layout?: 'fixed' | 'inline' | 'composer-flow'
    onExitVoiceMode?: () => void
    autoStartRecording?: boolean
    onTranscribe: (_text: string) => void
  } = $props()

  let phase = $state<VoiceTapPhase>('idle')
  let errorHint = $state('')
  /** Bump after restart so pulse animation resets. */
  let pulseKey = $state(0)

  let recordingStartMs = $state<number | null>(null)
  let elapsedSec = $state(0)

  let recorder: VoiceTapRecorder | null = null

  $effect(() => {
    if (phase === 'recording') {
      if (recordingStartMs === null) {
        recordingStartMs = Date.now()
      }
    } else {
      recordingStartMs = null
    }
  })

  $effect(() => {
    if (phase === 'arming') {
      elapsedSec = 0
    }
    if (phase === 'idle') {
      elapsedSec = 0
    }
  })

  $effect(() => {
    if (phase !== 'recording' || recordingStartMs === null) {
      return
    }
    const start = recordingStartMs
    const tick = () => {
      elapsedSec = Math.floor((Date.now() - start) / 1000)
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  })

  const showTimer = $derived(phase === 'arming' || phase === 'recording')
  const timerSeconds = $derived(phase === 'arming' ? 0 : phase === 'recording' ? elapsedSec : 0)
  const timerLabel = $derived(formatRecordingDuration(timerSeconds))

  onMount(() => {
    recorder = new VoiceTapRecorder({
      hearReplies,
      onPhase: (p) => {
        phase = p
      },
      onError: (msg) => {
        errorHint = msg
      },
      onTranscribe,
    })
    if (autoStartRecording && !disabled) {
      void (async () => {
        await tick()
        await tick()
        const r = recorder
        if (!r || disabled) return
        try {
          await navigator.vibrate?.(12)
        } catch {
          /* ignore */
        }
        await r.primaryAction()
      })()
    }
  })

  onDestroy(() => {
    recorder?.destroy()
    recorder = null
  })

  $effect(() => {
    recorder?.setHearReplies(hearReplies)
  })

  $effect(() => {
    recorder?.setHoldGated(holdGated)
  })

  async function primaryTap() {
    if (!recorder || disabled) return
    try {
      await navigator.vibrate?.(12)
    } catch {
      /* ignore */
    }
    await recorder.primaryAction()
  }

  async function restartTap() {
    if (!recorder || disabled) return
    try {
      await navigator.vibrate?.(10)
    } catch {
      /* ignore */
    }
    pulseKey += 1
    await recorder.restartAction()
  }

  function cancelTap() {
    if (!recorder || disabled) return
    try {
      navigator.vibrate?.(10)
    } catch {
      /* ignore */
    }
    recorder.cancelAction()
  }

  const showActions = $derived(phase === 'recording' || phase === 'arming')
  const actionsBusy = $derived(phase === 'transcribing' || disabled)
</script>

<div
  class="chat-voice-panel"
  class:chat-voice-panel--fixed={layout === 'fixed'}
  class:chat-voice-panel--inline={layout === 'inline'}
  class:chat-voice-panel--composer-flow={layout === 'composer-flow'}
  role="toolbar"
  aria-label="Voice input"
>
  <div class="chat-voice-panel-inner">
    <div class="chat-voice-left">
      {#if phase === 'transcribing'}
        <div class="chat-voice-processing" role="status" aria-live="polite" aria-atomic="true">
          <span class="chat-voice-processing-spin" aria-hidden="true">
            <Loader2 size={20} strokeWidth={2} />
          </span>
          <span class="chat-voice-processing-text">Transcribing…</span>
        </div>
      {:else if layout === 'composer-flow' && phase === 'idle' && onExitVoiceMode}
        <button
          type="button"
          class="voice-exit-keyboard"
          onclick={() => onExitVoiceMode()}
          aria-label="Type with keyboard"
          title="Keyboard"
        >
          <Keyboard size={20} strokeWidth={2.25} aria-hidden="true" />
        </button>
      {:else}
        <VoiceActionButtons
          visible={showActions}
          disabled={actionsBusy}
          onRestart={restartTap}
          onCancel={cancelTap}
        />
      {/if}
    </div>
    <div class="chat-voice-center">
      {#if showTimer}
        <span
          class="chat-voice-timer"
          aria-live="polite"
          aria-label={`Recording length ${timerLabel}`}
        >
          {timerLabel}
        </span>
      {/if}
    </div>
    <div class="chat-voice-primary-col">
      {#if phase === 'recording'}
        <RecordingWaveformIndicator />
      {:else if layout === 'composer-flow'}
        <div class="voice-waveform-placeholder" aria-hidden="true"></div>
      {/if}
      <VoicePrimaryButton
        {phase}
        {disabled}
        {holdGated}
        {pulseKey}
        onPrimary={primaryTap}
      />
    </div>
  </div>
  {#if errorHint}
    <p class="chat-voice-err" role="status">{errorHint}</p>
  {/if}
</div>

<style>
  .chat-voice-panel {
    display: flex;
    flex-direction: column;
    justify-content: center;
    box-sizing: border-box;
    min-height: 80px;
    flex-shrink: 0;
  }

  .chat-voice-panel--fixed {
    position: fixed;
    left: 0;
    right: 0;
    bottom: env(safe-area-inset-bottom, 0px);
    z-index: 20;
    background: color-mix(in srgb, var(--bg-2) 88%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid var(--border-1, rgba(255, 255, 255, 0.08));
    padding-bottom: 0;
  }

  .chat-voice-panel--inline {
    position: relative;
    z-index: 1;
    width: 100%;
    margin-top: 4px;
    margin-bottom: 2px;
    border-top: 1px solid var(--border-1, rgba(255, 255, 255, 0.08));
    background: color-mix(in srgb, var(--bg-2) 92%, transparent);
    border-radius: 0;
  }

  .chat-voice-panel--composer-flow {
    position: relative;
    z-index: 1;
    width: 100%;
    min-height: 56px;
    margin: 0;
    padding: 0;
    background: var(--bg-2);
    border: none;
    border-radius: 0;
  }

  /*
   * Composer stack: the primary tap/send control sits on the RIGHT (same lane as text-mode
   * send/mic) so it does not jump when switching modes; secondary actions (cancel/restart,
   * keyboard) sit on the left.
   */
  .chat-voice-panel--composer-flow .chat-voice-panel-inner {
    flex-direction: row;
  }

  .chat-voice-panel--composer-flow .chat-voice-primary-col {
    justify-content: flex-end;
    flex-direction: row;
    padding-right: max(10px, env(safe-area-inset-right, 0px));
    padding-left: 4px;
  }

  .voice-waveform-placeholder {
    flex-shrink: 0;
    box-sizing: border-box;
    min-width: 44px;
    width: 44px;
    height: 36px;
    padding: 0 2px;
    visibility: hidden;
    pointer-events: none;
  }

  .chat-voice-panel--composer-flow .chat-voice-left {
    justify-content: flex-start;
  }

  .chat-voice-panel--composer-flow .voice-exit-keyboard {
    margin-left: max(8px, env(safe-area-inset-left, 0px));
    margin-right: 0;
  }

  .chat-voice-panel--composer-flow .chat-voice-processing {
    padding-left: max(12px, env(safe-area-inset-left, 0px));
    padding-right: 8px;
  }

  .chat-voice-panel--composer-flow :global(.voice-actions) {
    transform: translateX(-8px);
  }

  .chat-voice-panel--composer-flow :global(.voice-actions--show) {
    transform: translateX(0);
    padding-left: max(10px, env(safe-area-inset-left, 0px));
    padding-right: 0;
  }

  .voice-exit-keyboard {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 44px;
    margin-left: max(8px, env(safe-area-inset-left, 0px));
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-3);
    color: var(--text-2);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
    -webkit-tap-highlight-color: transparent;
  }

  @media (hover: hover) {
    .voice-exit-keyboard:hover {
      background: var(--bg);
      color: var(--text);
    }
  }

  .voice-exit-keyboard:active {
    filter: brightness(0.97);
  }

  .chat-voice-panel-inner {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    flex: 1;
    min-height: 0;
    width: 100%;
  }

  .chat-voice-left {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 48%;
    display: flex;
    align-items: center;
  }

  .chat-voice-center {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
  }

  .chat-voice-timer {
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
    color: var(--text);
    line-height: 1;
    font-feature-settings: 'tnum' 1;
  }

  .chat-voice-processing {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding-left: max(12px, env(safe-area-inset-left, 0px));
    padding-right: 8px;
    animation: chat-voice-processing-in 180ms ease-out;
  }

  @keyframes chat-voice-processing-in {
    from {
      opacity: 0;
      transform: translateX(-6px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .chat-voice-processing {
      animation: none;
    }
  }

  .chat-voice-processing-spin {
    display: flex;
    flex-shrink: 0;
    color: var(--accent, #6366f1);
    animation: chat-voice-spin 0.85s linear infinite;
  }

  @keyframes chat-voice-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .chat-voice-processing-spin {
      animation: none;
    }
  }

  .chat-voice-processing-text {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .chat-voice-primary-col {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    flex-shrink: 0;
    min-width: 30%;
    max-width: 46%;
    padding-left: 4px;
  }

  .chat-voice-err {
    margin: 0;
    padding: 0 12px 4px;
    font-size: 11px;
    color: var(--text-2);
    text-align: center;
    line-height: 1.25;
  }

  @media (prefers-reduced-motion: reduce) {
    .chat-voice-panel--fixed {
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      background: var(--bg-2);
    }
    .chat-voice-panel--inline {
      background: var(--bg-2);
    }
    .chat-voice-panel--composer-flow {
      background: var(--bg-2);
    }
  }
</style>
