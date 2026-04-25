import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  filenameForAudioBlob,
  isWebKitDesktopSafariUserAgent,
  MAX_HOLD_SPEAK_MS,
  pickMediaRecorderMimeType,
  preferPcmHoldCapture,
  requestMicrophonePermissionInUserGesture,
  shouldUseMediaRecorderTimeslice,
} from './holdToSpeakMedia.js'

describe('holdToSpeakMedia', () => {
  const origM = globalThis.MediaRecorder
  const mockIsTypeSupported = vi.fn().mockReturnValue(false)

  beforeEach(() => {
    mockIsTypeSupported.mockReset()
    ;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = class {
      static isTypeSupported = mockIsTypeSupported
    } as unknown as typeof MediaRecorder
  })

  afterEach(() => {
    if (origM) {
      ;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = origM
    } else {
      delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder
    }
  })

  it('filenameForAudioBlob maps common types', () => {
    expect(filenameForAudioBlob('audio/wav')).toBe('recording.wav')
    expect(filenameForAudioBlob('audio/webm;codecs=opus')).toBe('recording.webm')
    expect(filenameForAudioBlob('audio/mp4')).toBe('recording.m4a')
    expect(filenameForAudioBlob('audio/ogg;codecs=opus')).toBe('recording.ogg')
    expect(filenameForAudioBlob('application/octet-stream')).toBe('recording.bin')
  })

  it('MAX_HOLD_SPEAK_MS is 3 minutes', () => {
    expect(MAX_HOLD_SPEAK_MS).toBe(180000)
  })

  it('pickMediaRecorderMimeType returns first supported candidate', () => {
    mockIsTypeSupported.mockImplementation(
      (m: string) => m === 'audio/webm' || m === 'audio/mp4',
    )
    expect(pickMediaRecorderMimeType()).toBe('audio/webm')
  })

  it('shouldUseMediaRecorderTimeslice is true for audio/mp4', () => {
    expect(shouldUseMediaRecorderTimeslice('audio/mp4')).toBe(true)
    expect(shouldUseMediaRecorderTimeslice('audio/webm;codecs=opus')).toBe(false)
    expect(shouldUseMediaRecorderTimeslice(undefined)).toBe(false)
  })

  it('preferPcmHoldCapture is true for iPhone UA', () => {
    const o = globalThis.navigator.userAgent
    Object.defineProperty(globalThis.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
      configurable: true,
    })
    try {
      expect(preferPcmHoldCapture()).toBe(true)
    } finally {
      Object.defineProperty(globalThis.navigator, 'userAgent', { value: o, configurable: true })
    }
  })

  it('isWebKitDesktopSafariUserAgent is true for macOS Safari, false for Chrome on Mac', () => {
    expect(
      isWebKitDesktopSafariUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
      ),
    ).toBe(true)
    expect(
      isWebKitDesktopSafariUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ),
    ).toBe(false)
  })

  it('preferPcmHoldCapture is true for desktop Safari (narrow layout / same engine)', () => {
    const o = globalThis.navigator.userAgent
    Object.defineProperty(globalThis.navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
      configurable: true,
    })
    try {
      expect(preferPcmHoldCapture()).toBe(true)
    } finally {
      Object.defineProperty(globalThis.navigator, 'userAgent', { value: o, configurable: true })
    }
  })

  it('pickMediaRecorderMimeType prefers audio/mp4 on iPhone (WebKit record path)', () => {
    const orig = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      configurable: true,
    })
    mockIsTypeSupported.mockImplementation(
      (m: string) =>
        m === 'audio/mp4' || m === 'audio/webm;codecs=opus' || m === 'audio/webm' || m === 'audio/ogg;codecs=opus',
    )
    try {
      expect(pickMediaRecorderMimeType()).toBe('audio/mp4')
    } finally {
      Object.defineProperty(navigator, 'userAgent', { value: orig, configurable: true })
    }
  })

  it('pickMediaRecorderMimeType returns undefined when nothing matches', () => {
    expect(pickMediaRecorderMimeType()).toBeUndefined()
  })

  describe('requestMicrophonePermissionInUserGesture', () => {
    const origMd = navigator.mediaDevices

    afterEach(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: origMd,
        configurable: true,
      })
    })

    it('calls getUserMedia with audio and stops tracks', async () => {
      const stop = vi.fn()
      const stream = { getTracks: () => [{ stop }] }
      const gUM = vi.fn().mockResolvedValue(stream)
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: gUM },
        configurable: true,
      })
      await requestMicrophonePermissionInUserGesture()
      const { HOLD_TO_SPEAK_AUDIO_CONSTRAINTS } = await import('./holdToSpeakMedia.js')
      expect(gUM).toHaveBeenCalledWith({ audio: HOLD_TO_SPEAK_AUDIO_CONSTRAINTS })
      expect(stop).toHaveBeenCalled()
    })

    it('swallows getUserMedia rejection', async () => {
      const gUM = vi.fn().mockRejectedValue(new Error('denied'))
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: gUM },
        configurable: true,
      })
      await expect(requestMicrophonePermissionInUserGesture()).resolves.toBeUndefined()
    })
  })
})
