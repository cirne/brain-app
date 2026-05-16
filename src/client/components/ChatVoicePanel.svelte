<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { Keyboard, Loader2 } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'
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
  const embeddedInComposer = $derived(layout === 'composer-flow')

  /** Container variants share base layout; layout-specific tweaks below. */
  const containerBase = $derived(
    embeddedInComposer
      ? 'chat-voice-panel box-border flex w-full shrink-0 flex-col justify-center'
      : 'chat-voice-panel box-border flex min-h-[80px] shrink-0 flex-col justify-center',
  )
  const containerByLayout = $derived.by(() => {
    if (layout === 'fixed') {
      return 'chat-voice-panel--fixed fixed inset-x-0 z-20 border-t border-[var(--border-1,rgba(255,255,255,0.08))] bg-[color-mix(in_srgb,var(--bg-2)_88%,transparent)] [bottom:env(safe-area-inset-bottom,0px)] [backdrop-filter:blur(12px)] [-webkit-backdrop-filter:blur(12px)] motion-reduce:bg-surface-2 motion-reduce:[backdrop-filter:none] motion-reduce:[-webkit-backdrop-filter:none]'
    }
    if (layout === 'inline') {
      return 'chat-voice-panel--inline relative z-[1] mt-1 mb-0.5 w-full border-t border-[var(--border-1,rgba(255,255,255,0.08))] bg-[color-mix(in_srgb,var(--bg-2)_92%,transparent)] motion-reduce:bg-surface-2'
    }
    return 'chat-voice-panel--composer-flow relative z-[1] m-0 min-h-0 w-full flex-1 border-none bg-transparent p-0'
  })
</script>

<div
  class={cn(containerBase, containerByLayout)}
  role="toolbar"
  aria-label={$t('chat.voice.toolbarAria')}
>
  {#if embeddedInComposer}
    <div class="input-composer flex min-h-[48px] w-full min-w-0 flex-1 flex-row items-stretch">
      <div
        class="lead-actions flex shrink-0 flex-row items-stretch self-stretch"
        role="group"
        aria-label={$t('chat.voice.toolbarAria')}
      >
        {#if phase === 'idle' && onExitVoiceMode}
          <button
            type="button"
            class="voice-exit-keyboard inline-flex shrink-0 cursor-pointer items-center justify-center self-stretch min-w-[48px] w-[48px] border-none border-r border-r-border bg-surface p-0 text-muted transition-colors duration-150 [-webkit-tap-highlight-color:transparent] hover:bg-surface-3 hover:text-foreground active:[filter:brightness(0.97)]"
            onclick={() => onExitVoiceMode()}
            aria-label={$t('chat.voice.typeWithKeyboardAria')}
            title={$t('chat.voice.keyboardTitle')}
          >
            <Keyboard size={20} strokeWidth={2.25} aria-hidden="true" />
          </button>
        {:else}
          <VoiceActionButtons
            visible={showActions}
            disabled={actionsBusy}
            embeddedInComposer={true}
            onRestart={restartTap}
            onCancel={cancelTap}
          />
        {/if}
      </div>
      <div class="chat-voice-center flex min-w-0 flex-1 items-center justify-center gap-2 px-1.5">
        {#if phase === 'transcribing'}
          <div
            class="chat-voice-processing flex min-w-0 items-center gap-2.5 [animation:chat-voice-processing-in_180ms_ease-out] motion-reduce:[animation:none]"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span
              class="chat-voice-processing-spin flex shrink-0 text-accent [animation:chat-voice-spin_0.85s_linear_infinite] motion-reduce:[animation:none]"
              aria-hidden="true"
            >
              <Loader2 size={20} strokeWidth={2} />
            </span>
            <span class="chat-voice-processing-text whitespace-nowrap text-[13px] font-medium tracking-[0.02em] text-muted"
              >{$t('chat.voice.transcribing')}</span
            >
          </div>
        {:else if showTimer}
          <span
            class="chat-voice-timer text-[11px] font-semibold leading-none tracking-[0.04em] text-foreground tabular-nums [font-feature-settings:'tnum'_1]"
            aria-live="polite"
            aria-label={$t('chat.voice.recordingLengthAria', { duration: timerLabel })}
          >
            {timerLabel}
          </span>
          {#if phase === 'recording'}
            <RecordingWaveformIndicator />
          {/if}
        {/if}
      </div>
      <div
        class="send-actions flex shrink-0 flex-row items-stretch self-stretch"
        role="group"
        aria-label={$t('chat.input.sendGroupAria')}
      >
        <VoicePrimaryButton
          {phase}
          {disabled}
          {holdGated}
          {pulseKey}
          embeddedInComposer={true}
          onPrimary={primaryTap}
        />
      </div>
    </div>
  {:else}
    <div class="chat-voice-panel-inner flex min-h-0 w-full flex-1 flex-row items-stretch">
      <div class="chat-voice-left flex max-w-[48%] min-w-0 flex-[0_1_auto] items-center">
        {#if phase === 'transcribing'}
          <div
            class="chat-voice-processing flex min-w-0 items-center gap-2.5 pr-2 [animation:chat-voice-processing-in_180ms_ease-out] motion-reduce:[animation:none] [padding-left:max(12px,env(safe-area-inset-left,0px))]"
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
            <span class="chat-voice-processing-text whitespace-nowrap text-[13px] font-medium tracking-[0.02em] text-muted"
              >{$t('chat.voice.transcribing')}</span
            >
          </div>
        {:else}
          <VoiceActionButtons
            visible={showActions}
            disabled={actionsBusy}
            embeddedInComposer={false}
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
            aria-label={$t('chat.voice.recordingLengthAria', { duration: timerLabel })}
          >
            {timerLabel}
          </span>
        {/if}
      </div>
      <div class="chat-voice-primary-col flex min-w-[30%] max-w-[46%] shrink-0 flex-row items-center justify-end gap-2.5 pl-1">
        {#if phase === 'recording'}
          <RecordingWaveformIndicator />
        {/if}
        <VoicePrimaryButton
          {phase}
          {disabled}
          {holdGated}
          {pulseKey}
          embeddedInComposer={false}
          onPrimary={primaryTap}
        />
      </div>
    </div>
  {/if}
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
</style>
