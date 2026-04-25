import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ensureHoldToSpeakAudioContextForPcm,
  _resetSharedHoldToSpeakAudioContextForTests,
} from './holdToSpeakAudioContext.js'

describe('holdToSpeakAudioContext', () => {
  const origAC = globalThis.AudioContext

  beforeEach(() => {
    if (typeof globalThis.window === 'undefined') {
      ;(globalThis as unknown as { window: typeof globalThis }).window = globalThis
    }
    _resetSharedHoldToSpeakAudioContextForTests()
    class MockAudioContext {
      state = 'suspended'
      sampleRate = 48000
      async resume(): Promise<void> {
        this.state = 'running'
      }
      async close(): Promise<void> {
        this.state = 'closed'
      }
      createMediaStreamSource = vi.fn()
      createScriptProcessor = vi.fn()
      createGain = vi.fn(() => ({
        gain: { value: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }))
      destination = {}
    }
    ;(globalThis as { AudioContext: typeof AudioContext }).AudioContext =
      MockAudioContext as unknown as typeof AudioContext
  })

  afterEach(() => {
    _resetSharedHoldToSpeakAudioContextForTests()
    if (origAC) {
      ;(globalThis as { AudioContext: typeof AudioContext }).AudioContext = origAC
    } else {
      delete (globalThis as { AudioContext?: unknown }).AudioContext
    }
  })

  it('ensureHoldToSpeakAudioContextForPcm returns running context and reuses the same instance', async () => {
    const a = await ensureHoldToSpeakAudioContextForPcm()
    expect(a.state).toBe('running')
    const b = await ensureHoldToSpeakAudioContextForPcm()
    expect(b).toBe(a)
  })
})
