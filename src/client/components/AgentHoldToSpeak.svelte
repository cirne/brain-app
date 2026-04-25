<script lang="ts">
  import { onMount } from 'svelte'
  import { Mic } from 'lucide-svelte'
  import { startPcmHoldCapture, type PcmStopResult } from '@client/lib/holdToSpeakPcmWav.js'
  import { ensureHoldToSpeakAudioContextForPcm } from '@client/lib/holdToSpeakAudioContext.js'
  import { setHoldToSpeakAudioSessionForCapture } from '@client/lib/holdToSpeakAudioSession.js'
  import { logHoldToSpeakDebug } from '@client/lib/holdToSpeakDebug.js'
  import {
    clearHoldToSpeakWarmStream,
    returnHoldToSpeakStreamForWarmReuse,
    takeWarmHoldToSpeakStreamIfAvailable,
    stopAndClearHoldToSpeakStream,
  } from '@client/lib/holdToSpeakWarmStream.js'
  import {
    filenameForAudioBlob,
    HOLD_TO_SPEAK_AUDIO_CONSTRAINTS,
    MAX_HOLD_SPEAK_MS,
    MIN_RECORDING_BYTES,
    MP4_MEDIARECORDER_TIMESLICE_MS,
    PENDING_RELEASE_STOP_DELAY_MS,
    pickMediaRecorderMimeType,
    preferPcmHoldCapture,
    shouldUseMediaRecorderTimeslice,
  } from '@client/lib/holdToSpeakMedia.js'

  type PcmHandle = { stop: () => PcmStopResult; dispose: () => void }
  type Session =
    | {
        kind: 'pcm'
        armAbort: AbortController
        stream: MediaStream
        pcm: PcmHandle
        maxTimer: ReturnType<typeof setTimeout>
        finalizeStarted: boolean
      }
    | {
        kind: 'mediarecorder'
        armAbort: AbortController
        stream: MediaStream
        recorder: MediaRecorder
        chunks: Blob[]
        maxTimer: ReturnType<typeof setTimeout>
        finalizeStarted: boolean
      }

  let {
    disabled = false,
    /** When true, parent hides this UI (Audio conversation off) but keeps layout; abort any in-flight capture. */
    holdGated = false,
    /**
     * Read-aloud on after the hold: used to reset `Navigator.audioSession` (WebKit) after capture
     * so TTS can route back cleanly.
     */
    hearReplies = true,
    onTranscribe,
  }: {
    disabled?: boolean
    holdGated?: boolean
    hearReplies?: boolean
    onTranscribe: (_text: string) => void
  } = $props()

  let isMobile = $state(false)
  type Phase = 'idle' | 'arming' | 'recording' | 'transcribing'
  let phase = $state<Phase>('idle')
  let errorHint = $state('')

  /** In-flight hold session; not reactive — only touched from pointer handlers. */
  let session: Session | null = null
  /** Set while `getUserMedia` is pending (before {@link session} exists). */
  let armInFlight: AbortController | null = null
  /**
   * User released during `arming` before a session exists — do not abort mic; when recording
   * starts, end immediately (iOS often releases in this window).
   */
  let pendingRelease = false
  /** `setTimeout` for release-during-arming — must not fire after new hold / cleanup. */
  let scheduledPendingStop: ReturnType<typeof setTimeout> | null = null

  function clearPendingStopTimer() {
    if (scheduledPendingStop != null) {
      clearTimeout(scheduledPendingStop)
      scheduledPendingStop = null
    }
  }

  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => {
      isMobile = mq.matches
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  })

  /** Only `holdGated` is read so this does not re-run on `phase` / `errorHint` (would stop mid-recording). */
  $effect(() => {
    if (!holdGated) {
      return
    }
    clearHoldToSpeakWarmStream()
    if (armInFlight) {
      try {
        armInFlight.abort()
      } catch {
        /* ignore */
      }
      armInFlight = null
    }
    if (session) {
      stopSessionMedia(session)
      clearSession()
    }
    phase = 'idle'
    errorHint = ''
    pendingRelease = false
    clearPendingStopTimer()
  })

  function stopSessionMedia(s: Session | null) {
    if (s == null) {
      return
    }
    setHoldToSpeakAudioSessionForCapture(false, hearReplies)
    clearTimeout(s.maxTimer)
    if (s.kind === 'pcm') {
      s.pcm.dispose()
    } else {
      try {
        if (s.recorder.state === 'recording') {
          s.recorder.stop()
        }
      } catch {
        /* ignore */
      }
    }
    stopAndClearHoldToSpeakStream(s.stream)
  }

  function clearSession() {
    session = null
  }

  function stopButtonLabel(): string {
    if (phase === 'recording') {
      return 'Release to send'
    }
    if (phase === 'arming') {
      return 'Preparing mic…'
    }
    if (phase === 'transcribing') {
      return 'Transcribing…'
    }
    return 'Hold to speak'
  }

  async function onPointerDown(e: PointerEvent) {
    if (!isMobile || holdGated || disabled || phase === 'transcribing') {
      return
    }
    e.preventDefault()
    const btn = e.currentTarget as HTMLButtonElement
    btn.setPointerCapture(e.pointerId)
    errorHint = ''
    pendingRelease = false
    clearPendingStopTimer()
    phase = 'arming'
    const armAbort = new AbortController()
    armInFlight = armAbort

    try {
      const taken = takeWarmHoldToSpeakStreamIfAvailable()
      let stream: MediaStream
      let prewarmedCtx: Awaited<ReturnType<typeof ensureHoldToSpeakAudioContextForPcm>> | undefined
      if (taken) {
        stream = taken
        try {
          prewarmedCtx = await ensureHoldToSpeakAudioContextForPcm()
        } catch (ensureErr) {
          stopAndClearHoldToSpeakStream(taken)
          armInFlight = null
          throw ensureErr
        }
        logHoldToSpeakDebug('stream_source', { source: 'warm' })
      } else {
        const gP = navigator.mediaDevices.getUserMedia({
          audio: HOLD_TO_SPEAK_AUDIO_CONSTRAINTS,
          signal: armAbort.signal,
        })
        const eP = ensureHoldToSpeakAudioContextForPcm()
        const [gR, eR] = await Promise.allSettled([gP, eP])
        if (eR.status === 'rejected' && gR.status === 'fulfilled') {
          gR.value.getTracks().forEach((t) => t.stop())
        }
        if (gR.status === 'rejected') {
          if (eR.status === 'fulfilled') {
            /* keep shared AudioContext for a later attempt */
          }
          armInFlight = null
          throw (gR as PromiseRejectedResult).reason
        }
        if (eR.status === 'rejected') {
          gR.value.getTracks().forEach((t) => t.stop())
          armInFlight = null
          throw (eR as PromiseRejectedResult).reason
        }
        stream = gR.value
        prewarmedCtx = eR.value
        logHoldToSpeakDebug('stream_source', { source: 'getUserMedia' })
      }
      armInFlight = null
      if (armAbort.signal.aborted) {
        stopAndClearHoldToSpeakStream(stream)
        pendingRelease = false
        phase = 'idle'
        return
      }
      const tracksAfterGum = stream.getAudioTracks()
      if (tracksAfterGum.some((t) => t.readyState !== 'live')) {
        stopAndClearHoldToSpeakStream(stream)
        errorHint = 'Microphone did not start — try again.'
        phase = 'idle'
        return
      }
      setHoldToSpeakAudioSessionForCapture(true, hearReplies)
      const usePcm = preferPcmHoldCapture()
      logHoldToSpeakDebug('gum_ok', {
        usePcm,
        trackStates: tracksAfterGum.map((t) => t.readyState),
      })
      let s: Session
      if (usePcm) {
        let pcm: PcmHandle
        try {
          pcm = await startPcmHoldCapture(stream, MAX_HOLD_SPEAK_MS / 1000, {
            prewarmedContext: prewarmedCtx,
            leaveStreamLiveForWarmReuse: true,
          })
        } catch (e) {
          stopAndClearHoldToSpeakStream(stream)
          logHoldToSpeakDebug('pcm_start_failed', {
            name: e instanceof Error ? e.name : String(e),
            message: e instanceof Error ? e.message : '',
          })
          errorHint = 'Could not start audio capture'
          setHoldToSpeakAudioSessionForCapture(false, hearReplies)
          phase = 'idle'
          return
        }
        s = {
          kind: 'pcm',
          armAbort,
          stream,
          pcm,
          finalizeStarted: false,
          maxTimer: setTimeout(() => {
            if (session === s) {
              void endRecordingFromRelease()
            }
          }, MAX_HOLD_SPEAK_MS),
        }
        session = s
        logHoldToSpeakDebug('recording', { path: 'pcm' })
        phase = 'recording'
        if (pendingRelease) {
          pendingRelease = false
          clearPendingStopTimer()
          scheduledPendingStop = setTimeout(() => {
            scheduledPendingStop = null
            void endRecordingFromRelease()
          }, PENDING_RELEASE_STOP_DELAY_MS)
        }
        return
      }
      const chunks: Blob[] = []
      const chosen = pickMediaRecorderMimeType()
      const recorder = new MediaRecorder(stream, chosen ? { mimeType: chosen } : undefined)
      s = {
        kind: 'mediarecorder',
        armAbort,
        stream,
        recorder,
        chunks,
        finalizeStarted: false,
        maxTimer: setTimeout(() => {
          if (session === s) {
            void endRecordingFromRelease()
          }
        }, MAX_HOLD_SPEAK_MS),
      }
      session = s
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          chunks.push(ev.data)
        }
      }
      recorder.onerror = () => {
        errorHint = 'Recording failed'
        pendingRelease = false
        stopSessionMedia(s)
        clearSession()
        phase = 'idle'
      }
      if (shouldUseMediaRecorderTimeslice(chosen)) {
        recorder.start(MP4_MEDIARECORDER_TIMESLICE_MS)
      } else {
        recorder.start()
      }
      logHoldToSpeakDebug('recording', { path: 'mediarecorder', mime: chosen ?? 'default' })
      phase = 'recording'
      if (pendingRelease) {
        pendingRelease = false
        clearPendingStopTimer()
        scheduledPendingStop = setTimeout(() => {
          scheduledPendingStop = null
          void endRecordingFromRelease()
        }, PENDING_RELEASE_STOP_DELAY_MS)
      }
    } catch (err) {
      armInFlight = null
      pendingRelease = false
      if (err instanceof Error && err.name === 'AbortError') {
        phase = 'idle'
        clearSession()
        return
      }
      const name = err instanceof Error ? err.name : ''
      if (name === 'NotAllowedError') {
        errorHint = 'Microphone access was blocked'
      } else {
        errorHint = 'Could not use the microphone'
      }
      phase = 'idle'
      clearSession()
    }
  }

  function onPointerUp(e: PointerEvent) {
    const btn = e.currentTarget as HTMLButtonElement
    if (btn.hasPointerCapture(e.pointerId)) {
      try {
        btn.releasePointerCapture(e.pointerId)
      } catch {
        /* WebKit: releasing after disabled / capture already lost */
      }
    }
    void endRecordingFromRelease()
  }

  function onTouchEnd() {
    /* iOS / simulator: complement `pointerup` (both may fire; finalize guard dedupes). */
    void endRecordingFromRelease()
  }

  function endRecordingFromRelease() {
    if (phase === 'transcribing' || phase === 'idle') {
      return
    }
    const s = session
    if (phase === 'arming' && s == null) {
      // Include post–getUserMedia, pre-`session` (armInFlight null) so release still queues a stop.
      pendingRelease = true
      return
    }
    if (phase === 'recording' && s) {
      if (s.finalizeStarted) {
        return
      }
      s.finalizeStarted = true
      if (s.kind === 'pcm') {
        clearTimeout(s.maxTimer)
        const pcmOut = s.pcm.stop()
        setHoldToSpeakAudioSessionForCapture(false, hearReplies)
        logHoldToSpeakDebug('pcm_stop', {
          rms: pcmOut.rms,
          approxDurationSec: pcmOut.approxDurationSec,
          sampleCount: pcmOut.sampleCount,
        })
        clearSession()
        if (pcmOut.rms < 1e-4 && pcmOut.approxDurationSec > 0.25) {
          clearHoldToSpeakWarmStream()
          errorHint = 'No audio signal (mic may have been interrupted). Check Audio is on, then try again.'
          phase = 'idle'
          return
        }
        phase = 'transcribing'
        void finishWithBlob(pcmOut.blob)
        return
      }
      const { recorder, chunks, stream, maxTimer } = s
      clearTimeout(maxTimer)
      /*
       * WebKit (iOS): set `onstop` and call `stop()` before updating phase / disabling
       * the control — doing so first broke release so `onstop` never ran.
       * Show “Transcribing…” on the next microtask (still right after `stop()`).
       */
      recorder.onstop = () => {
        const tracks = stream.getTracks()
        const mime = recorder.mimeType || 'audio/webm'
        const sum = () => chunks.reduce((a, c) => a + c.size, 0)
        let finalized = false
        const complete = (deferred: string) => {
          if (finalized) {
            return
          }
          const bytes = sum()
          if (bytes === 0 && deferred !== 'timeout50') {
            return
          }
          finalized = true
          setHoldToSpeakAudioSessionForCapture(false, hearReplies)
          logHoldToSpeakDebug('mediarecorder_stop', { bytes, deferred, mime })
          if (bytes > 0) {
            returnHoldToSpeakStreamForWarmReuse(stream)
          } else {
            for (const t of tracks) {
              t.stop()
            }
          }
          clearSession()
          void finishWithBlob(new Blob(chunks, { type: mime }))
        }
        /* WebKit: last ondataavailable may run after onstop. */
        queueMicrotask(() => {
          if (sum() > 0) {
            complete('microtask')
            return
          }
          setTimeout(() => {
            if (sum() > 0) {
              complete('t0')
              return
            }
            setTimeout(() => {
              complete('timeout50')
            }, 50)
          }, 0)
        })
      }
      try {
        if (recorder.state === 'recording') {
          const withReq = recorder as MediaRecorder & { requestData?: () => void }
          if (typeof withReq.requestData === 'function') {
            try {
              withReq.requestData()
            } catch {
              /* ignore */
            }
          }
          recorder.stop()
          queueMicrotask(() => {
            if (phase === 'recording') {
              phase = 'transcribing'
            }
          })
        } else {
          s.finalizeStarted = false
          clearSession()
          phase = 'idle'
        }
      } catch {
        s.finalizeStarted = false
        stopSessionMedia(s)
        clearSession()
        phase = 'idle'
      }
    }
  }

  async function finishWithBlob(blob: Blob) {
    if (blob.size < MIN_RECORDING_BYTES) {
      clearHoldToSpeakWarmStream()
      errorHint = 'No audio captured — hold a moment, then release'
      phase = 'idle'
      return
    }
    try {
      const name = filenameForAudioBlob(blob.type)
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
      const fd = new FormData()
      fd.set('audio', file)
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      })
      const j = (await res.json().catch(() => ({}))) as { text?: string; message?: string }
      if (res.status === 503) {
        errorHint = 'Speech-to-text is not available on the server'
        phase = 'idle'
        return
      }
      if (!res.ok) {
        errorHint = typeof j.message === 'string' ? j.message : 'Transcription failed'
        phase = 'idle'
        return
      }
      const text = typeof j.text === 'string' ? j.text.trim() : ''
      if (text.length > 0) {
        onTranscribe(text)
      }
    } catch {
      errorHint = 'Transcription request failed'
    } finally {
      phase = 'idle'
    }
  }
</script>

{#if isMobile}
  <div class="hold-speak">
    <button
      type="button"
      class="hold-speak-btn"
      class:hold-speak-btn--active={phase === 'recording' || phase === 'arming'}
      class:hold-speak-btn--busy={phase === 'transcribing'}
      disabled={disabled}
      aria-busy={phase === 'transcribing'}
      onpointerdown={onPointerDown}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onlostpointercapture={onPointerUp}
      ontouchend={onTouchEnd}
      title={stopButtonLabel()}
      aria-label={stopButtonLabel()}
    >
      <Mic class="hold-speak-mic" size={36} strokeWidth={2} aria-hidden="true" />
    </button>
    <p class="hold-speak-status">{stopButtonLabel()}</p>
    {#if errorHint}
      <p class="hold-speak-err" role="status">{errorHint}</p>
    {/if}
  </div>
{/if}

<style>
  .hold-speak {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    touch-action: manipulation;
  }

  .hold-speak-btn {
    --hold-red: #e53935;
    --hold-red-dark: #b71c1c;
    --hold-red-pressed: #c62828;
    display: flex;
    width: 90px;
    height: 90px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 50%;
    border: 3px solid var(--hold-red-dark);
    background: var(--hold-red);
    color: #fff;
    box-shadow:
      0 2px 8px rgba(183, 28, 28, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
    transition:
      transform 0.1s ease,
      background 0.15s ease,
      box-shadow 0.15s ease;
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  :global(.hold-speak-mic) {
    color: #fff;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.2));
  }

  .hold-speak-btn:disabled {
    opacity: 0.5;
    box-shadow: none;
  }

  .hold-speak-btn--busy {
    pointer-events: none;
    opacity: 0.55;
  }

  .hold-speak-btn:not(:disabled):active,
  .hold-speak-btn--active:not(:disabled) {
    transform: scale(0.94);
    background: var(--hold-red-pressed);
    box-shadow:
      0 1px 4px rgba(0, 0, 0, 0.35),
      inset 0 2px 6px rgba(0, 0, 0, 0.2);
  }

  .hold-speak-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .hold-speak-status {
    margin: 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-2);
    text-align: center;
    max-width: 12rem;
    line-height: 1.3;
  }

  .hold-speak-err {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
    text-align: center;
    max-width: 16rem;
  }
</style>
