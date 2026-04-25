/**
 * One shared `AudioContext` for hold-to-speak PCM so Safari is not given a fresh
 * `new AudioContext` + `resume` deep in an `await` chain after getUserMedia (BUG-023).
 * Graph nodes (source, script processor) are still per capture.
 */
let shared: AudioContext | null = null

function getContextConstructor(): (typeof window.AudioContext) | null {
  if (typeof window === 'undefined') {
    return null
  }
  return window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
}

/**
 * Resets shared context (for tests). Do not use in production.
 */
export function _resetSharedHoldToSpeakAudioContextForTests(): void {
  if (shared != null) {
    void shared.close().catch(() => {})
  }
  shared = null
}

/**
 * Returns a running (or resumable) `AudioContext` for PCM capture, creating it if needed.
 * Does not call `close()`; callers only disconnect their nodes so the next hold reuses
 * the same context.
 */
export async function ensureHoldToSpeakAudioContextForPcm(): Promise<AudioContext> {
  const AC = getContextConstructor()
  if (!AC) {
    throw new Error('AudioContext is not available')
  }
  if (shared == null || shared.state === 'closed') {
    shared = new AC()
  }
  if (shared.state === 'suspended' || shared.state === 'interrupted') {
    await shared.resume()
  }
  if (shared.state !== 'running' && shared.state !== 'closed') {
    await shared.resume().catch(() => {})
  }
  if (shared.state === 'suspended' || shared.state === 'interrupted') {
    throw new Error('AudioContext not running after resume')
  }
  if (shared.state === 'closed') {
    throw new Error('AudioContext closed')
  }
  return shared
}
