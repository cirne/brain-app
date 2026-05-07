<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { Keyboard, Loader2 } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import { formatRecordingDuration } from '@client/lib/voicePanelFormat.js'
  import { VoiceTapRecorder, type VoiceTapPhase } from '@client/lib/voiceTapCapture.js'
  import VoiceActionButtons from '@components/VoiceActionButtons.svelte'
  import VoicePrimaryButton from '@components/VoicePrimaryButton.svelte'
  import RecordingWaveformIndicator from '@components/RecordingWaveformIndicator.svelte'

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
    console.log('[effect-debug]', 'src/client/components/ChatVoicePanel.svelte', '#1')
    if (phase === 'recording') {
      if (recordingStartMs === null) {
        recordingStartMs = Date.now()
      }
    } else {
      recordingStartMs = null
    }
  })

  $effect(() => {
    console.log('[effect-debug]', 'src/client/components/ChatVoicePanel.svelte', '#2')
    if (phase === 'arming') {
      elapsedSec = 0
    }
    if (phase === 'idle') {
      elapsedSec = 0
    }
  })

  $effect(() => {
    console.log('[effect-debug]', 'src/client/components/ChatVoicePanel.svelte', '#3')
    if (phase !== 'recording' || recordingStartMs === null) {
      return
    }
    const start = recordingStartMs
    const tickFn = () => {
      elapsedSec = Math.floor((Date.now() - start) / 1000)
    }
    tickFn()
    const id = setInterval(tickFn, 250)
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
    console.log('[effect-debug]', 'src/client/components/ChatVoicePanel.svelte', '#4')
    recorder?.setHearReplies(hearReplies)
  })

  $effect(() => {
    console.log('[effect-debug]', 'src/client/components/ChatVoicePanel.svelte', '#5')
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

  /** Container variants share base layout; layout-specific tweaks below. */
  const containerBase =
    'chat-voice-panel box-border flex min-h-[80px] shrink-0 flex-col justify-center'
  const containerByLayout = $derived.by(() => {
    if (layout === 'fixed') {
      return 'chat-voice-panel--fixed fixed inset-x-0 z-20 border-t border-[var(--border-1,rgba(255,255,255,0.08))] bg-[color-mix(in_srgb,var(--bg-2)_88%,transparent)] [bottom:env(safe-area-inset-bottom,0px)] [backdrop-filter:blur(12px)] [-webkit-backdrop-filter:blur(12px)] motion-reduce:bg-surface-2 motion-reduce:[backdrop-filter:none] motion-reduce:[-webkit-backdrop-filter:none]'
    }
    if (layout === 'inline') {
      return 'chat-voice-panel--inline relative z-[1] mt-1 mb-0.5 w-full border-t border-[var(--border-1,rgba(255,255,255,0.08))] bg-[color-mix(in_srgb,var(--bg-2)_92%,transparent)] motion-reduce:bg-surface-2'
    }
    return 'chat-voice-panel--composer-flow relative z-[1] m-0 min-h-[56px] w-full border-none bg-surface-2 p-0 motion-reduce:bg-surface-2'
  })
</script>

<div
  class={cn(containerBase, containerByLayout)}
  role="toolbar"
  aria-label="Voice input"
>
  <div
    class={cn(
      'chat-voice-panel-inner flex min-h-0 w-full flex-1 flex-row items-stretch',
      layout === 'composer-flow' && 'flex-row',
    )}
  >
    <div
      class={cn(
        'chat-voice-left flex max-w-[48%] min-w-0 flex-[0_1_auto] items-center',
        layout === 'composer-flow' && 'justify-start',
      )}
    >
      {#if phase === 'transcribing'}
        <div
          class={cn(
            'chat-voice-processing flex min-w-0 items-center gap-2.5 pr-2 [animation:chat-voice-processing-in_180ms_ease-out] motion-reduce:[animation:none]',
            '[padding-left:max(12px,env(safe-area-inset-left,0px))]',
          )}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span
            class="chat-voice-processing-spin flex shrink-0 text-[var(--accent,#6366f1)] [animation:chat-voice-spin_0.85s_linear_infinite] motion-reduce:[animation:none]"
            aria-hidden="true"
          >
            <Loader2 size={20} strokeWidth={2} />
          </span>
          <span class="chat-voice-processing-text whitespace-nowrap text-[13px] font-medium tracking-[0.02em] text-muted">Transcribing…</span>
        </div>
      {:else if layout === 'composer-flow' && phase === 'idle' && onExitVoiceMode}
        <button
          type="button"
          class="voice-exit-keyboard inline-flex h-11 min-w-[44px] cursor-pointer items-center justify-center border border-border bg-surface-3 p-0 text-muted transition-colors duration-150 [-webkit-tap-highlight-color:transparent] hover:bg-surface hover:text-foreground active:[filter:brightness(0.97)] [margin-left:max(8px,env(safe-area-inset-left,0px))]"
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
    <div class="chat-voice-center flex flex-1 min-w-0 items-center justify-center px-1.5">
      {#if showTimer}
        <span
          class="chat-voice-timer text-[11px] font-semibold leading-none tracking-[0.04em] text-foreground tabular-nums [font-feature-settings:'tnum'_1]"
          aria-live="polite"
          aria-label={`Recording length ${timerLabel}`}
        >
          {timerLabel}
        </span>
      {/if}
    </div>
    <div
      class={cn(
        'chat-voice-primary-col flex min-w-[30%] max-w-[46%] shrink-0 flex-row items-center justify-end gap-2.5 pl-1',
        layout === 'composer-flow' &&
          'justify-end pl-1 [padding-right:max(10px,env(safe-area-inset-right,0px))]',
      )}
    >
      {#if phase === 'recording'}
        <RecordingWaveformIndicator />
      {:else if layout === 'composer-flow'}
        <div
          class="voice-waveform-placeholder pointer-events-none invisible box-border h-9 min-w-[44px] w-[44px] shrink-0 px-0.5"
          aria-hidden="true"
        ></div>
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
    <p class="chat-voice-err m-0 px-3 pb-1 text-center text-[11px] leading-tight text-muted" role="status">{errorHint}</p>
  {/if}
</div>

<style>
  /* Keyframes referenced by Tailwind arbitrary `animation` utilities above. */
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

  @keyframes chat-voice-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Layout-scoped child overrides on already-rendered child components. */
  .chat-voice-panel--composer-flow :global(.voice-actions) {
    transform: translateX(-8px);
  }

  .chat-voice-panel--composer-flow :global(.voice-actions--show) {
    transform: translateX(0);
    padding-left: max(10px, env(safe-area-inset-left, 0px));
    padding-right: 0;
  }
</style>
