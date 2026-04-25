/** Max single recording length (Whisper / UX cap). */
export const MAX_HOLD_SPEAK_MS = 3 * 60 * 1000

/** Reject near-empty blobs (tap / glitches). */
export const MIN_RECORDING_BYTES = 32

/**
 * If the user released during `arming`, wait this long after `recorder.start()` before
 * auto-stopping — instant stop often yields 0 B on WebKit.
 */
export const PENDING_RELEASE_STOP_DELAY_MS = 320

/**
 * iOS / Safari: `start()` with no timeslice can leave `ondataavailable` for the last
 * chunk after `onstop` — a modest timeslice keeps the encoder warm and populates `chunks` sooner.
 * Ignored for non-mp4 to avoid the old “slice before first chunk” path on other codecs.
 */
export const MP4_MEDIARECORDER_TIMESLICE_MS = 200

/**
 * `getUserMedia` hints for hold-to-speak. Mono + processing reduces stereo routing bugs and helps STT.
 */
export const HOLD_TO_SPEAK_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const

export function shouldUseMediaRecorderTimeslice(mime: string | undefined): boolean {
  if (!mime) {
    return false
  }
  return mime.includes('mp4') || mime === 'audio/m4a'
}

/**
 * Desktop Safari (macOS): same WebKit `MediaRecorder` / capture quirks as iOS; prefer PCM+WAV.
 * Excludes Chrome, Edge, Firefox, and other UAs that include "Chrome" or engine-specific tags.
 */
export function isWebKitDesktopSafariUserAgent(ua: string): boolean {
  if (!/AppleWebKit\//.test(ua) || !/Version\/\d+/.test(ua) || !/Safari\//.test(ua)) {
    return false
  }
  if (!/(Mac OS X|Macintosh)/.test(ua)) {
    return false
  }
  if (/\b(CriOS|FxiOS|OPiOS|EdgiOS|EdgA)\b/.test(ua)) {
    return false
  }
  if (/\b(Chrome|Chromium|Edg)\//.test(ua)) {
    return false
  }
  return true
}

/**
 * WebKit on iPhone / iPad / **desktop Safari** often yields 0 B from `MediaRecorder` or
 * needs the PCM path for reliable STT; use raw PCM + WAV (see `holdToSpeakPcmWav.ts`).
 */
export function preferPcmHoldCapture(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent || ''
  if (isWebKitDesktopSafariUserAgent(ua)) {
    return true
  }
  if (/iPhone|iPad|iPod/.test(ua)) {
    return true
  }
  if (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0 && /Macintosh/.test(ua)) {
    return true
  }
  return false
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const

/** iOS / iPad / Android: WebKit + Chrome often record reliably as AAC in mp4, not as WebM. */
function preferMp4First(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod|Android/i.test(ua)) {
    return true
  }
  // iPadOS 13+ may report as Macintosh; still WebKit media stack.
  if (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 0 && /Macintosh/.test(ua)) {
    return true
  }
  return false
}

function orderedMimeCandidates(): readonly string[] {
  if (!preferMp4First()) {
    return MIME_CANDIDATES
  }
  const withMp4 = ['audio/mp4' as const, ...MIME_CANDIDATES.filter((m) => m !== 'audio/mp4')]
  return withMp4
}

/**
 * Returns a MIME type `MediaRecorder` supports, or `undefined` for browser default.
 */
export function pickMediaRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') {
    return undefined
  }
  for (const m of orderedMimeCandidates()) {
    if (MediaRecorder.isTypeSupported(m)) {
      return m
    }
  }
  return undefined
}

/**
 * Requests microphone access in the same user gesture (e.g. enabling Audio conversation).
 * Stops tracks immediately so we only retain permission for later hold-to-speak.
 * Primes a shared `AudioContext` for PCM capture (Safari / BUG-023) when possible.
 */
export async function requestMicrophonePermissionInUserGesture(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: HOLD_TO_SPEAK_AUDIO_CONSTRAINTS })
    stream.getTracks().forEach((t) => t.stop())
    const { ensureHoldToSpeakAudioContextForPcm } = await import('./holdToSpeakAudioContext.js')
    void ensureHoldToSpeakAudioContextForPcm().catch(() => {})
  } catch {
    /* denied, no device, or insecure context — hold-to-speak can prompt again */
  }
}

import { ensureHoldToSpeakAudioContextForPcm } from './holdToSpeakAudioContext.js'

/** File name for multipart upload; helps Whisper infer format. */
export function filenameForAudioBlob(mime: string): string {
  if (mime.includes('wav')) {
    return 'recording.wav'
  }
  if (mime.includes('webm')) {
    return 'recording.webm'
  }
  if (mime.includes('mp4') || mime === 'audio/mp4' || mime === 'audio/m4a') {
    return 'recording.m4a'
  }
  if (mime.includes('ogg')) {
    return 'recording.ogg'
  }
  return 'recording.bin'
}
