/**
 * WebKit / iOS: align mic + playback routing when TTS and capture share the page (see BUG-023).
 * `Navigator.audioSession` — feature-detect; no-op on unsupported engines.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AudioSession
 */

type AudioSessionNav = Navigator & { audioSession?: { type: string } }

function getSession(): { type: string } | null {
  if (typeof navigator === 'undefined') {
    return null
  }
  const s = (navigator as AudioSessionNav).audioSession
  return s && typeof s.type === 'string' ? s : null
}

/**
 * @param ttsOnAfter — parent `hearReplies`: restore playback session for assistant audio after hold.
 */
export function setHoldToSpeakAudioSessionForCapture(
  active: boolean,
  ttsOnAfter: boolean = false,
): void {
  const s = getSession()
  if (s == null) {
    return
  }
  if (active) {
    s.type = 'play-and-record'
    return
  }
  if (ttsOnAfter) {
    s.type = 'playback'
  }
  s.type = 'auto'
}
