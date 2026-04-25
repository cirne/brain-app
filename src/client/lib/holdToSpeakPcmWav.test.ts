import { describe, it, expect } from 'vitest'
import { buildWavBlobMonoPcm16, downmixStereoToMono, _test } from './holdToSpeakPcmWav.js'

describe('holdToSpeakPcmWav', () => {
  it('mergeFloat32 joins chunks', () => {
    const a = new Float32Array([1, 2])
    const b = new Float32Array([3, 4, 5])
    const m = _test.mergeFloat32([a, b])
    expect([...m]).toEqual([1, 2, 3, 4, 5])
  })

  it('buildWavBlobMonoPcm16 produces RIFF WAVE and correct data size (mono 16-bit)', () => {
    const s = 48000
    const samples = new Float32Array([0, 0.5, -0.5])
    const blob = buildWavBlobMonoPcm16(samples, s)
    expect(blob.size).toBe(44 + 3 * 2)
    return blob.arrayBuffer().then((ab) => {
      const u8 = new Uint8Array(ab)
      const td = new TextDecoder()
      expect(td.decode(u8.subarray(0, 4))).toBe('RIFF')
      expect(td.decode(u8.subarray(8, 12))).toBe('WAVE')
    })
  })

  it('buildWavBlobMonoPcm16 returns empty blob for zero samples', () => {
    const b = buildWavBlobMonoPcm16(new Float32Array(0), 16000)
    expect(b.size).toBe(0)
  })

  it('downmixStereoToMono keeps full scale when the other channel is near silent', () => {
    const l = new Float32Array([0.2, 0.2])
    const r = new Float32Array([0, 0])
    const m = downmixStereoToMono(l, r)
    expect(m[0]).toBeCloseTo(0.2)
  })

  it('downmixStereoToMono averages when both sides carry signal', () => {
    const l = new Float32Array([0.2])
    const r = new Float32Array([0.2])
    const m = downmixStereoToMono(l, r)
    expect(m[0]).toBeCloseTo(0.2)
  })
})
