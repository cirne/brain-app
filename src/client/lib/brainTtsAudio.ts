/**
 * OpenAI TTS audio playback. HTMLMediaElement.play() after async SSE is often blocked
 * as autoplay; we resume an AudioContext during a user gesture (send / toggle) and
 * play decoded audio later with Web Audio API.
 */

const SESSION_OK_KEY = 'brainTtsAutoplaySessionOk'

let sharedContext: AudioContext | null = null

/** Bumped whenever we abandon in-flight playback (conversation switch, new send, toggle off). */
let playbackGeneration = 0

const activeBufferSources = new Set<AudioBufferSourceNode>()

type HtmlTracked = { el: HTMLAudioElement; url: string }
let activeHtml: HtmlTracked[] = []

/**
 * Stop all TTS from {@link playBrainTtsBlob} — Web Audio buffers and HTML fallback elements.
 * Use when switching chats, starting a new turn, turning “hear replies” off, or stopping generation.
 */
export function stopBrainTtsPlayback(): void {
  playbackGeneration++
  for (const s of activeBufferSources) {
    try {
      s.stop()
    } catch {
      /* already stopped */
    }
    try {
      s.disconnect()
    } catch {
      /* ignore */
    }
  }
  activeBufferSources.clear()
  for (const { el, url } of activeHtml) {
    try {
      el.pause()
      el.removeAttribute('src')
      el.load()
    } catch {
      /* ignore */
    }
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
  activeHtml = []
}

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

export type PlayBrainTtsBlobOptions = {
  /**
   * Called after awaits (resume/decode); return false to drop playback — e.g. user switched chats
   * or toggled hear off while decoding.
   */
  continuePlayback?: () => boolean
}

/**
 * Play TTS bytes (e.g. MP3) from a Blob. Prefer Web Audio after {@link primeBrainTtsFromUserGesture};
 * falls back to `HTMLAudioElement` if decode fails.
 */
export async function playBrainTtsBlob(
  blob: Blob,
  options?: PlayBrainTtsBlobOptions,
): Promise<void> {
  const capturedGen = playbackGeneration
  const continueOk = (): boolean =>
    capturedGen === playbackGeneration && (options?.continuePlayback?.() ?? true)

  const tryWebAudio = async (): Promise<void> => {
    const ctx = getAudioContext()
    await ctx.resume()
    if (!continueOk()) return
    const ab = await blob.arrayBuffer()
    if (!continueOk()) return
    const buffer = await ctx.decodeAudioData(ab.slice(0))
    if (!continueOk()) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    return new Promise((resolve, reject) => {
      source.onended = () => {
        activeBufferSources.delete(source)
        resolve()
      }
      try {
        activeBufferSources.add(source)
        source.start(0)
      } catch (e) {
        activeBufferSources.delete(source)
        reject(e)
      }
    })
  }

  try {
    await tryWebAudio()
  } catch {
    if (!continueOk()) return
    const url = URL.createObjectURL(blob)
    const el = new Audio()
    el.src = url
    const tracked: HtmlTracked = { el, url }
    activeHtml.push(tracked)
    if (!continueOk()) {
      cleanupHtmlAudio(tracked)
      return
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const detach = (): void => {
          const ix = activeHtml.indexOf(tracked)
          if (ix !== -1) activeHtml.splice(ix, 1)
          try {
            URL.revokeObjectURL(url)
          } catch {
            /* ignore */
          }
        }
        el.addEventListener('ended', () => {
          detach()
          resolve()
        })
        el.addEventListener('error', () => {
          detach()
          reject(new Error('HTMLAudioElement error'))
        })
        void el.play().catch(reject)
      })
    } catch {
      cleanupHtmlAudio(tracked)
      throw new Error('TTS playback failed')
    }
  }
}

function cleanupHtmlAudio(tracked: HtmlTracked): void {
  const ix = activeHtml.indexOf(tracked)
  if (ix !== -1) activeHtml.splice(ix, 1)
  try {
    tracked.el.pause()
    tracked.el.removeAttribute('src')
    tracked.el.load()
  } catch {
    /* ignore */
  }
  try {
    URL.revokeObjectURL(tracked.url)
  } catch {
    /* ignore */
  }
}
