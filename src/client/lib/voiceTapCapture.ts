/**
 * Tap-to-talk voice capture for chat (OPP-055): MediaRecorder or PCM + POST /api/transcribe.
 * Extracted from hold-to-speak (AgentHoldToSpeak) — same browser quirks, different UX lifecycle.
 */
import { startPcmHoldCapture, type PcmStopResult } from './holdToSpeakPcmWav.js'
import { ensureHoldToSpeakAudioContextForPcm } from './holdToSpeakAudioContext.js'
import { setHoldToSpeakAudioSessionForCapture } from './holdToSpeakAudioSession.js'
import { logHoldToSpeakDebug } from './holdToSpeakDebug.js'
import {
  clearHoldToSpeakWarmStream,
  returnHoldToSpeakStreamForWarmReuse,
  takeWarmHoldToSpeakStreamIfAvailable,
  stopAndClearHoldToSpeakStream,
} from './holdToSpeakWarmStream.js'
import {
  filenameForAudioBlob,
  HOLD_TO_SPEAK_AUDIO_CONSTRAINTS,
  MAX_HOLD_SPEAK_MS,
  MIN_RECORDING_BYTES,
  MP4_MEDIARECORDER_TIMESLICE_MS,
  pickMediaRecorderMimeType,
  preferPcmHoldCapture,
  shouldUseMediaRecorderTimeslice,
} from './holdToSpeakMedia.js'

export type VoiceTapPhase = 'idle' | 'arming' | 'recording' | 'transcribing'

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

export type VoiceTapRecorderOptions = {
  hearReplies: boolean
  onPhase: (p: VoiceTapPhase) => void
  onError: (msg: string) => void
  onTranscribe: (text: string) => void
}

export class VoiceTapRecorder {
  private hearReplies: boolean
  private readonly onPhase: (p: VoiceTapPhase) => void
  private readonly onError: (msg: string) => void
  private readonly onTranscribe: (text: string) => void

  private phase: VoiceTapPhase = 'idle'
  private session: Session | null = null
  private armInFlight: AbortController | null = null
  private holdGated = false

  constructor(opts: VoiceTapRecorderOptions) {
    this.hearReplies = opts.hearReplies
    this.onPhase = opts.onPhase
    this.onError = opts.onError
    this.onTranscribe = opts.onTranscribe
  }

  setHearReplies(v: boolean) {
    this.hearReplies = v
  }

  setHoldGated(gated: boolean) {
    this.holdGated = gated
    if (!gated) {
      return
    }
    this.abortAllForGate()
  }

  private setPhase(p: VoiceTapPhase) {
    this.phase = p
    this.onPhase(p)
  }

  private abortAllForGate() {
    clearHoldToSpeakWarmStream()
    if (this.armInFlight) {
      try {
        this.armInFlight.abort()
      } catch {
        /* ignore */
      }
      this.armInFlight = null
    }
    if (this.session) {
      this.stopSessionMedia(this.session)
      this.session = null
    }
    this.setPhase('idle')
    this.onError('')
  }

  destroy() {
    this.setHoldGated(true)
  }

  /** Idle → arm → record; recording → commit transcribe. */
  async primaryAction() {
    if (this.holdGated) {
      return
    }
    if (this.phase === 'transcribing' || this.phase === 'arming') {
      return
    }
    if (this.phase === 'recording') {
      await this.commitRecording()
      return
    }
    await this.startRecording()
  }

  /** Discard current take and start a new recording without returning to idle. */
  async restartAction() {
    if (this.holdGated || this.phase !== 'recording' || !this.session) {
      return
    }
    this.discardActiveRecording()
    await this.startRecording()
  }

  /** Discard recording; no transcription. */
  cancelAction() {
    if (this.holdGated) {
      return
    }
    if (this.armInFlight) {
      try {
        this.armInFlight.abort()
      } catch {
        /* ignore */
      }
      this.armInFlight = null
    }
    if (this.phase === 'arming') {
      this.setPhase('idle')
      this.onError('')
      return
    }
    if (this.phase === 'recording' && this.session) {
      this.discardActiveRecording()
    }
    this.setPhase('idle')
    this.onError('')
  }

  private discardActiveRecording() {
    const s = this.session
    if (!s) {
      return
    }
    s.finalizeStarted = true
    this.stopSessionMedia(s)
    this.session = null
  }

  private stopSessionMedia(s: Session | null) {
    if (s == null) {
      return
    }
    setHoldToSpeakAudioSessionForCapture(false, this.hearReplies)
    clearTimeout(s.maxTimer)
    if (s.kind === 'pcm') {
      s.pcm.dispose()
    } else {
      try {
        s.recorder.onstop = null
        if (s.recorder.state === 'recording') {
          s.recorder.stop()
        }
      } catch {
        /* ignore */
      }
    }
    stopAndClearHoldToSpeakStream(s.stream)
  }

  private async startRecording() {
    this.onError('')
    this.setPhase('arming')
    const armAbort = new AbortController()
    this.armInFlight = armAbort

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
          this.armInFlight = null
          throw ensureErr
        }
        logHoldToSpeakDebug('stream_source', { source: 'warm' })
      } else {
        const gP = navigator.mediaDevices.getUserMedia({
          audio: HOLD_TO_SPEAK_AUDIO_CONSTRAINTS,
          signal: armAbort.signal,
        } as MediaStreamConstraints & { signal: AbortSignal })
        const eP = ensureHoldToSpeakAudioContextForPcm()
        const [gR, eR] = await Promise.allSettled([gP, eP])
        if (eR.status === 'rejected' && gR.status === 'fulfilled') {
          gR.value.getTracks().forEach((t) => t.stop())
        }
        if (gR.status === 'rejected') {
          if (eR.status === 'fulfilled') {
            /* keep shared AudioContext */
          }
          this.armInFlight = null
          throw (gR as PromiseRejectedResult).reason
        }
        if (eR.status === 'rejected') {
          gR.value.getTracks().forEach((t) => t.stop())
          this.armInFlight = null
          throw (eR as PromiseRejectedResult).reason
        }
        stream = gR.value
        prewarmedCtx = eR.value
        logHoldToSpeakDebug('stream_source', { source: 'getUserMedia' })
      }
      this.armInFlight = null
      if (armAbort.signal.aborted) {
        stopAndClearHoldToSpeakStream(stream)
        this.setPhase('idle')
        return
      }
      const tracksAfterGum = stream.getAudioTracks()
      if (tracksAfterGum.some((t) => t.readyState !== 'live')) {
        stopAndClearHoldToSpeakStream(stream)
        this.onError('Microphone did not start — try again.')
        this.setPhase('idle')
        return
      }
      setHoldToSpeakAudioSessionForCapture(true, this.hearReplies)
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
          this.onError('Could not start audio capture')
          setHoldToSpeakAudioSessionForCapture(false, this.hearReplies)
          this.setPhase('idle')
          return
        }
        s = {
          kind: 'pcm',
          armAbort,
          stream,
          pcm,
          finalizeStarted: false,
          maxTimer: setTimeout(() => {
            if (this.session === s) {
              void this.commitRecording()
            }
          }, MAX_HOLD_SPEAK_MS),
        }
        this.session = s
        logHoldToSpeakDebug('recording', { path: 'pcm' })
        this.setPhase('recording')
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
          if (this.session === s) {
            void this.commitRecording()
          }
        }, MAX_HOLD_SPEAK_MS),
      }
      this.session = s
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          chunks.push(ev.data)
        }
      }
      recorder.onerror = () => {
        this.onError('Recording failed')
        this.stopSessionMedia(s)
        this.session = null
        this.setPhase('idle')
      }
      if (shouldUseMediaRecorderTimeslice(chosen)) {
        recorder.start(MP4_MEDIARECORDER_TIMESLICE_MS)
      } else {
        recorder.start()
      }
      logHoldToSpeakDebug('recording', { path: 'mediarecorder', mime: chosen ?? 'default' })
      this.setPhase('recording')
    } catch (err) {
      this.armInFlight = null
      if (err instanceof Error && err.name === 'AbortError') {
        this.setPhase('idle')
        this.session = null
        return
      }
      const name = err instanceof Error ? err.name : ''
      if (name === 'NotAllowedError') {
        this.onError('Microphone access was blocked')
      } else {
        this.onError('Could not use the microphone')
      }
      this.setPhase('idle')
      this.session = null
    }
  }

  private async commitRecording() {
    if (this.phase === 'transcribing' || this.phase === 'idle') {
      return
    }
    const s = this.session
    if (this.phase === 'arming' && s == null) {
      return
    }
    if (this.phase === 'recording' && s) {
      if (s.finalizeStarted) {
        return
      }
      s.finalizeStarted = true
      if (s.kind === 'pcm') {
        clearTimeout(s.maxTimer)
        const pcmOut = s.pcm.stop()
        setHoldToSpeakAudioSessionForCapture(false, this.hearReplies)
        logHoldToSpeakDebug('pcm_stop', {
          rms: pcmOut.rms,
          approxDurationSec: pcmOut.approxDurationSec,
          sampleCount: pcmOut.sampleCount,
        })
        this.session = null
        if (pcmOut.rms < 1e-4 && pcmOut.approxDurationSec > 0.25) {
          clearHoldToSpeakWarmStream()
          this.onError('No audio signal (mic may have been interrupted). Check Audio is on, then try again.')
          this.setPhase('idle')
          return
        }
        this.setPhase('transcribing')
        await this.finishWithBlob(pcmOut.blob)
        return
      }
      const { recorder, chunks, stream, maxTimer } = s
      clearTimeout(maxTimer)
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
          setHoldToSpeakAudioSessionForCapture(false, this.hearReplies)
          logHoldToSpeakDebug('mediarecorder_stop', { bytes, deferred, mime })
          if (bytes > 0) {
            returnHoldToSpeakStreamForWarmReuse(stream)
          } else {
            for (const t of tracks) {
              t.stop()
            }
          }
          this.session = null
          void this.finishWithBlob(new Blob(chunks, { type: mime }))
        }
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
            if (this.phase === 'recording') {
              this.setPhase('transcribing')
            }
          })
        } else {
          s.finalizeStarted = false
          this.session = null
          this.setPhase('idle')
        }
      } catch {
        s.finalizeStarted = false
        this.stopSessionMedia(s)
        this.session = null
        this.setPhase('idle')
      }
    }
  }

  private async finishWithBlob(blob: Blob) {
    if (blob.size < MIN_RECORDING_BYTES) {
      clearHoldToSpeakWarmStream()
      this.onError('No audio captured — tap record and try again')
      this.setPhase('idle')
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
        this.onError('Speech-to-text is not available on the server')
        this.setPhase('idle')
        return
      }
      if (!res.ok) {
        this.onError(typeof j.message === 'string' ? j.message : 'Transcription failed')
        this.setPhase('idle')
        return
      }
      const text = typeof j.text === 'string' ? j.text.trim() : ''
      if (text.length > 0) {
        this.onTranscribe(text)
      }
    } catch {
      this.onError('Transcription request failed')
    } finally {
      this.setPhase('idle')
    }
  }
}
