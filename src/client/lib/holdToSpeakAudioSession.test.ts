import { describe, it, expect, afterEach } from 'vitest'
import { setHoldToSpeakAudioSessionForCapture } from './holdToSpeakAudioSession.js'

describe('holdToSpeakAudioSession', () => {
  const orig = Object.getOwnPropertyDescriptor(navigator, 'audioSession')

  afterEach(() => {
    if (orig) {
      Object.defineProperty(navigator, 'audioSession', orig)
    } else {
      try {
        delete (navigator as Navigator & { audioSession?: unknown }).audioSession
      } catch {
        /* ignore */
      }
    }
  })

  it('is a no-op when navigator.audioSession is missing', () => {
    Object.defineProperty(navigator, 'audioSession', { value: undefined, configurable: true })
    expect(() => setHoldToSpeakAudioSessionForCapture(true, false)).not.toThrow()
  })

  it('sets play-and-record when active', () => {
    const session = { type: 'auto' as string }
    Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true })
    setHoldToSpeakAudioSessionForCapture(true, false)
    expect(session.type).toBe('play-and-record')
  })

  it('ends with playback then auto when tts is on', () => {
    const session = { type: 'play-and-record' as string }
    Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true })
    setHoldToSpeakAudioSessionForCapture(false, true)
    expect(session.type).toBe('auto')
  })

  it('ends with auto when tts is off', () => {
    const session = { type: 'play-and-record' as string }
    Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true })
    setHoldToSpeakAudioSessionForCapture(false, false)
    expect(session.type).toBe('auto')
  })
})
