/**
 * OpenAI TTS audio playback. HTMLMediaElement.play() after async SSE is often blocked
 * as autoplay; we resume an AudioContext during a user gesture (send / toggle) and
 * play decoded audio later with Web Audio API.
 */

const SESSION_OK_KEY = 'brainTtsAutoplaySessionOk'

let sharedContext: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (sharedContext) return sharedContext
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!Ctor) {
    throw new Error('AudioContext is not available')
  }
  sharedContext = new Ctor()
  return sharedContext
}

export function isBrainTtsAutoplaySessionOk(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_OK_KEY) === '1'
  } catch {
    return false
  }
}

export function markBrainTtsAutoplaySessionOk(): void {
  try {
    sessionStorage.setItem(SESSION_OK_KEY, '1')
  } catch {
    /* private mode, quota */
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('brain-tts-autoplay-ok'))
    } catch {
      /* ignore */
    }
  }
}

/**
 * Synchronous “prime” (same tick as a click). Use when you cannot await; prefer
 * {@link ensureBrainTtsAutoplayInUserGesture} for a full unlock + session flag.
 */
export function primeBrainTtsFromUserGesture(): void {
  try {
    const ctx = getAudioContext()
    void ctx.resume()
  } catch {
    /* ignore */
  }
}

/**
 * Run in a user gesture: resume Web Audio, play a 1-frame silent blip, and mark
 * this tab session as autoplay-OK so delayed TTS can play. Idempotent: if the
 * session is already OK, only `resume()`s.
 */
export async function ensureBrainTtsAutoplayInUserGesture(): Promise<void> {
  if (isBrainTtsAutoplaySessionOk()) {
    const ctx = getAudioContext()
    await ctx.resume()
    return
  }
  try {
    const ctx = getAudioContext()
    await ctx.resume()
    const buffer = ctx.createBuffer(1, 1, 22050)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    try {
      source.start(0)
    } catch {
      /* non-fatal */
    }
  } catch {
    /* non-fatal */
  }
  markBrainTtsAutoplaySessionOk()
}

/**
 * Play TTS bytes (e.g. MP3) from a Blob. Prefer Web Audio after {@link primeBrainTtsFromUserGesture};
 * falls back to `HTMLAudioElement` if decode fails.
 */
export async function playBrainTtsBlob(blob: Blob): Promise<void> {
  const tryWebAudio = async (): Promise<void> => {
    const ctx = getAudioContext()
    await ctx.resume()
    const ab = await blob.arrayBuffer()
    const buffer = await ctx.decodeAudioData(ab.slice(0))
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    return new Promise((resolve, reject) => {
      source.onended = () => {
        resolve()
      }
      try {
        source.start(0)
      } catch (e) {
        reject(e)
      }
    })
  }

  try {
    await tryWebAudio()
  } catch {
    const url = URL.createObjectURL(blob)
    const el = new Audio()
    el.src = url
    try {
      await new Promise<void>((resolve, reject) => {
        el.addEventListener('ended', () => {
          URL.revokeObjectURL(url)
          resolve()
        })
        el.addEventListener('error', () => {
          URL.revokeObjectURL(url)
          reject(new Error('HTMLAudioElement error'))
        })
        void el.play().catch(reject)
      })
    } catch {
      URL.revokeObjectURL(url)
      throw new Error('TTS playback failed')
    }
  }
}
