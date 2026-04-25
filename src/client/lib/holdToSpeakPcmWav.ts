/**
 * iOS / WebKit: `MediaRecorder` often emits 0 B from `ondataavailable` in WKWebView / Mobile Safari.
 * Raw PCM via ScriptProcessor + WAV wrapper is a reliable path for the same `MediaStream`.
 * Uses a shared `AudioContext` (see `holdToSpeakAudioContext.ts`) to avoid `resume` in a
 * fresh context after a long getUserMedia await on Safari.
 * @deprecated ScriptProcessor is legacy but still the portable choice for a tiny capture without Worklets.
 */

import { ensureHoldToSpeakAudioContextForPcm } from './holdToSpeakAudioContext.js'
import {
  returnHoldToSpeakStreamForWarmReuse,
  stopAndClearHoldToSpeakStream,
} from './holdToSpeakWarmStream.js'

/** Smaller = lower first-buffer latency; cost is more onaudioprocess calls. */
const SCRIPT_PROC_BUFFER = 1024
/** If |r| (or |l|) is this small vs the other, treat as silent to avoid 6 dB downmix on single-mic. */
const SILENT_VERSUS_OTHER = 1e-4

function mergeFloat32(chunks: Float32Array[]): Float32Array {
  const n = chunks.reduce((a, b) => a + b.length, 0)
  const m = new Float32Array(n)
  let o = 0
  for (const c of chunks) {
    m.set(c, o)
    o += c.length
  }
  return m
}

/** Same length; used for stereo mics and tests. */
export function downmixStereoToMono(l: Float32Array, r: Float32Array): Float32Array {
  const len = l.length
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const a = l[i]!
    const b = r[i]!
    const t = Math.max(Math.abs(a), Math.abs(b), 1e-6)
    if (Math.abs(b) < SILENT_VERSUS_OTHER * t) {
      out[i] = a
    } else if (Math.abs(a) < SILENT_VERSUS_OTHER * t) {
      out[i] = b
    } else {
      out[i] = 0.5 * (a + b)
    }
  }
  return out
}

/**
 * One ScriptProcessor `inputBuffer` (often stereo) → mono; avoids losing voice on one side or −6 dB
 * when a device still exposes a near-silent 2nd channel.
 */
export function downmixToMonoInPlace(buf: AudioBuffer): Float32Array {
  const n = buf.numberOfChannels
  const len = buf.length
  const out = new Float32Array(len)
  if (n === 1) {
    out.set(buf.getChannelData(0))
    return out
  }
  if (n === 2) {
    return downmixStereoToMono(buf.getChannelData(0), buf.getChannelData(1))
  }
  for (let c = 0; c < n; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < len; i++) {
      out[i] += ch[i]! / n
    }
  }
  return out
}

function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0
  }
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!
    sum += x * x
  }
  return Math.sqrt(sum / samples.length)
}

/**
 * 16-bit mono little-endian PCM inside a minimal RIFF WAVE. Suitable for OpenAI `audio.transcriptions`.
 */
export function buildWavBlobMonoPcm16(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length
  if (n === 0) {
    return new Blob([], { type: 'audio/wav' })
  }
  const dataSize = n * 2
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(off + i, s.charCodeAt(i))
    }
  }
  w(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits
  w(36, 'data')
  view.setUint32(40, dataSize, true)
  let o = 44
  for (let i = 0; i < n; i++) {
    const f = Math.max(-1, Math.min(1, samples[i]!))
    const s16 =
      f < 0
        ? Math.max(-32768, Math.min(0, Math.round(f * 32768)))
        : Math.min(32767, Math.max(0, Math.round(f * 32767)))
    view.setInt16(o, s16, true)
    o += 2
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export type PcmStopResult = {
  blob: Blob
  sampleRate: number
  sampleCount: number
  rms: number
  /** Duration of PCM payload (WAV is longer by 44 B header). */
  approxDurationSec: number
}

type PcmResult = { stop: () => PcmStopResult; dispose: () => void }

function disconnectPcmGraph(
  source: MediaStreamAudioSourceNode,
  processor: ScriptProcessorNode,
  gain: GainNode,
) {
  try {
    processor.onaudioprocess = null
  } catch {
    /* ignore */
  }
  try {
    source.disconnect()
  } catch {
    /* ignore */
  }
  try {
    processor.disconnect()
  } catch {
    /* ignore */
  }
  try {
    gain.disconnect()
  } catch {
    /* ignore */
  }
}

export type StartPcmHoldOptions = {
  /**
   * When set (e.g. after `Promise.all` with gUM), avoids an extra `ensure` + `resume` in the
   * getUserMedia await chain.
   */
  prewarmedContext?: AudioContext
  /** On successful `stop()`, leave the gUM track live for the next hold (see `holdToSpeakWarmStream.ts`). */
  leaveStreamLiveForWarmReuse?: boolean
}

/**
 * Start capturing mono float samples from `stream` (must already be from `getUserMedia` with
 * `HOLD_TO_SPEAK_AUDIO_CONSTRAINTS` when available).
 * Call `stop()` when the user releases the button; `dispose()` on cancel / parent cleanup (no valid blob).
 */
export async function startPcmHoldCapture(
  stream: MediaStream,
  maxSec: number = 3 * 60,
  options: StartPcmHoldOptions = {},
): Promise<PcmResult> {
  const { prewarmedContext, leaveStreamLiveForWarmReuse = false } = options
  const ctx = prewarmedContext ?? (await ensureHoldToSpeakAudioContextForPcm())
  const bufs: Float32Array[] = []
  const maxSamp = Math.floor(maxSec * ctx.sampleRate)
  const source = ctx.createMediaStreamSource(stream)
  /** Two input channels: many iOS mics still surface stereo; we downmix in `ondata`. */
  const proc = ctx.createScriptProcessor(SCRIPT_PROC_BUFFER, 2, 1)
  const gain = ctx.createGain()
  gain.gain.value = 0
  let total = 0
  let closed = false

  proc.onaudioprocess = (e) => {
    if (closed) {
      return
    }
    const ib = e.inputBuffer
    const len = ib.length
    if (len === 0) {
      return
    }
    const mono = downmixToMonoInPlace(ib)
    const room = maxSamp - total
    if (room <= 0) {
      return
    }
    const take = Math.min(mono.length, room)
    bufs.push(take < mono.length ? new Float32Array(mono.subarray(0, take)) : new Float32Array(mono))
    total += take
  }

  source.connect(proc)
  proc.connect(gain)
  gain.connect(ctx.destination)
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
    await ctx.resume()
  }

  const shut = (keepSamples: boolean) => {
    if (closed) {
      return
    }
    closed = true
    if (!keepSamples) {
      bufs.length = 0
    }
    disconnectPcmGraph(source, proc, gain)
  }

  return {
    stop: () => {
      const rate = ctx.sampleRate
      shut(true)
      if (leaveStreamLiveForWarmReuse) {
        returnHoldToSpeakStreamForWarmReuse(stream)
      } else {
        stopAndClearHoldToSpeakStream(stream)
      }
      const merged = mergeFloat32(bufs)
      const rms = rmsOf(merged)
      const blob = buildWavBlobMonoPcm16(merged, rate)
      return {
        blob,
        sampleRate: rate,
        sampleCount: merged.length,
        rms,
        approxDurationSec: rate > 0 ? merged.length / rate : 0,
      }
    },
    dispose: () => {
      shut(false)
      stopAndClearHoldToSpeakStream(stream)
    },
  }
}

export const _test = { mergeFloat32 }
