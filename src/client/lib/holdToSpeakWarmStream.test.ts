import { describe, it, expect, beforeEach } from 'vitest'
import {
  takeWarmHoldToSpeakStreamIfAvailable,
  returnHoldToSpeakStreamForWarmReuse,
  stopAndClearHoldToSpeakStream,
  clearHoldToSpeakWarmStream,
} from './holdToSpeakWarmStream.js'

function mockStream(ended = false) {
  const t = {
    readyState: ended ? 'ended' : 'live' as const,
    stop: () => {
      t.readyState = 'ended' as 'live' | 'ended'
    },
  }
  return {
    getAudioTracks: () => [t],
    getTracks: () => [t],
  } as unknown as MediaStream
}

describe('holdToSpeakWarmStream', () => {
  beforeEach(() => {
    clearHoldToSpeakWarmStream()
  })

  it('take returns null when empty', () => {
    expect(takeWarmHoldToSpeakStreamIfAvailable()).toBeNull()
  })

  it('return then take returns the same live stream', () => {
    const s = mockStream()
    returnHoldToSpeakStreamForWarmReuse(s)
    expect(takeWarmHoldToSpeakStreamIfAvailable()).toBe(s)
    expect(takeWarmHoldToSpeakStreamIfAvailable()).toBeNull()
  })

  it('stopAndClear forgets a warmed stream', () => {
    const s = mockStream()
    returnHoldToSpeakStreamForWarmReuse(s)
    takeWarmHoldToSpeakStreamIfAvailable()
    returnHoldToSpeakStreamForWarmReuse(s)
    stopAndClearHoldToSpeakStream(s)
    expect(takeWarmHoldToSpeakStreamIfAvailable()).toBeNull()
  })

  it('replaces a previous warm with a new return', () => {
    const a = mockStream()
    const b = mockStream()
    returnHoldToSpeakStreamForWarmReuse(a)
    returnHoldToSpeakStreamForWarmReuse(b)
    const t = (a as unknown as { getAudioTracks: () => { readyState: string }[] }).getAudioTracks()[0]!
    expect(t.readyState).toBe('ended')
  })
})
