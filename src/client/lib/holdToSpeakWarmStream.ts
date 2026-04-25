/**
 * Keeps a live getUserMedia stream between hold-to-speak ends so the next hold can
 * attach the graph immediately; avoids losing the first 1–3s of speech while gUM
 * and WebKit unmute the mic.
 */

let warm: MediaStream | null = null

/**
 * If a live stream was left from the previous successful release, take it and clear the slot.
 * Caller owns the stream until the next return or hard stop.
 */
export function takeWarmHoldToSpeakStreamIfAvailable(): MediaStream | null {
  if (warm == null) {
    return null
  }
  const t = warm.getAudioTracks()[0]
  if (!t || t.readyState !== 'live') {
    warm = null
    return null
  }
  const s = warm
  warm = null
  return s
}

/**
 * Return the track to the pool without stopping. If another stream is still warm, it is stopped.
 */
export function returnHoldToSpeakStreamForWarmReuse(stream: MediaStream): void {
  if (warm != null && warm !== stream) {
    for (const tr of warm.getTracks()) {
      tr.stop()
    }
  }
  warm = stream
}

/**
 * Stops the stream and forgets a warm ref if it was the same.
 */
export function stopAndClearHoldToSpeakStream(stream: MediaStream): void {
  for (const t of stream.getTracks()) {
    t.stop()
  }
  if (warm === stream) {
    warm = null
  }
}

/**
 * Frees any pooled stream (gating, errors, unmount, permission denial).
 */
export function clearHoldToSpeakWarmStream(): void {
  if (warm == null) {
    return
  }
  for (const t of warm.getTracks()) {
    t.stop()
  }
  warm = null
}
